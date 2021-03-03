/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
// eslint-disable-next-line no-underscore-dangle
process.env.HELIX_FETCH_FORCE_HTTP1 = process.env.__OW_ACTIVATION_ID;

const { wrap } = require('@adobe/openwhisk-action-utils');
const { logger } = require('@adobe/openwhisk-action-logger');
const { wrap: status } = require('@adobe/helix-status');
const Fastly = require('@adobe/fastly-native-promises');
const { utils } = require('@adobe/helix-shared');
const fetchAPI = require('@adobe/helix-fetch');

/* istanbul ignore next */
const { fetch, Response } = process.env.HELIX_FETCH_FORCE_HTTP1

  ? fetchAPI.context({
    alpnProtocols: [fetchAPI.ALPN_HTTP1_1],
  })
  : fetchAPI;
const commence = require('./stop');

function getMdUrl(host, path, log) {
  let mdPath;
  const file = path.split('/').pop() || 'index'; // use 'index' if no filename
  if (file.endsWith('.html')) {
    mdPath = path.replace(/\.html$/, '.md');
  } else if (!file.includes('.')) {
    mdPath = `${path.endsWith(file) ? path : `${path}${file}`}.md`;
  }
  if (!mdPath) {
    log.debug('not an html document, so no markdown purging required');
    return null;
  }
  const ghDetails = host.split('.')[0].split('--');
  if (ghDetails.length < 2) {
    log.warn('invalid inner cdn url');
    return null;
  }
  const owner = ghDetails.pop();
  const repo = ghDetails.pop();
  const branch = ghDetails[0] || 'master';
  return `https://${branch}--${repo}--${owner}.hlx.page${mdPath}`;
}

async function purgeInner(host, path, service, token, log) {
  const results = [];
  const mdUrl = getMdUrl(host, path, log);
  if (mdUrl) {
    try {
      const res = await fetch(mdUrl, {
        method: 'PURGE',
      });
      const msg = await res.text();
      log.debug(msg);
      if (!res.ok) {
        throw new Error(msg);
      }
      results.push({ status: 'ok', url: mdUrl });
    } catch (e) {
      log.error('Unable to purge content proxy', e);
      results.push({ status: 'error', url: mdUrl });
    }
  }
  const url = `https://${host}${path}`;
  try {
    const f = Fastly(token, service);
    const surrogateKey = utils.computeSurrogateKey(url.replace(/\?.*$/, ''));
    log.info('Purging inner CDN with surrogate key', surrogateKey);
    await f.purgeKey(surrogateKey);
    results.push({ status: 'ok', url });
  } catch (e) {
    log.error('Unable to purge inner CDN', e);
    results.push({ status: 'error', url });
  }
  return results.length === 1 ? results[0] : results;
}

async function purgeOuter(host, path, log, exact) {
  const url = `https://${host}${path}`;
  log.info('Purging', url);
  const results = [];
  try {
    const res = await fetch(url, {
      method: 'PURGE',
    });
    const msg = await res.text();
    log.debug(msg);
    if (!res.ok) {
      throw new Error(msg);
    }
    results.push({ status: 'ok', url });
  } catch (e) {
    log.error('Unable to purge outer CDN', e);
    return { status: 'error', url };
  }
  if (!exact) {
    const file = path.split('/').pop();
    if (!file) {
      // directory, also purge index(.html)
      results.push(await purgeOuter(host, `${path}index`, log, true));
      results.push(await purgeOuter(host, `${path}index.html`, log, true));
    } else {
      if (file === 'index' || file === 'index.html') {
        // index(.html), also purge directory
        results.push(await purgeOuter(host, path.substring(0, path.lastIndexOf('/') + 1), log, true));
      }
      if (file.endsWith('.html')) {
        // file with .html extension, also purge without extension
        results.push(await purgeOuter(host, path.substring(0, path.lastIndexOf('.')), log, true));
      } else if (!file.includes('.')) {
        // file without extension, also purge with .html extension
        results.push(await purgeOuter(host, `${path}.html`, log, true));
      }
    }
  }
  return results.length === 1 ? results[0] : results;
}

/**
 * This is the main function
 * @param {Request} req The Request
 * @param {Context} context The context
 * @returns {Promise<Response>} The response
 */
async function main(req, context) {
  const { searchParams } = new URL(req.url);
  const host = searchParams.get('host');
  const path = searchParams.get('path') || '';
  const xfh = searchParams.get('xfh') || '';

  const { env, log } = context;
  const { HLX_PAGES_FASTLY_SVC_ID, HLX_PAGES_FASTLY_TOKEN } = env;

  let results = [];

  if (!(await commence(log))) {
    return new Response(JSON.stringify({
      status: 'error',
      message: 'Refusing to purge while Helix Pages responses are inconsistent. Check status.project-helix.io for details.',
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  if (host && HLX_PAGES_FASTLY_SVC_ID && HLX_PAGES_FASTLY_TOKEN) {
    results.push(await purgeInner(
      host,
      path,
      HLX_PAGES_FASTLY_SVC_ID,
      HLX_PAGES_FASTLY_TOKEN,
      log,
    ));
  } else {
    log.warn(`Not purging inner CDN for ${host}${path} due to missing fastly credentials`);
  }
  results.push(...await Promise.all(Array.from(new Set(xfh
    .split(',')
    .map((fwhost) => fwhost.trim())
    .filter((fwhost) => !!fwhost)))
    .map((fwhost) => purgeOuter(fwhost, path, log))));
  results = results.flat(2);

  if (results.length === 0) {
    return new Response(JSON.stringify(results), {
      status: 204,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
  if (!results.find((r) => r.status !== 'ok')) {
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  return new Response(JSON.stringify(results), {
    status: 207,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

module.exports.main = wrap(main)
  .with(status)
  .with(logger.trace)
  .with(logger);

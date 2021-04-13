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
const { wrap, utils } = require('@adobe/helix-shared');
const { logger } = require('@adobe/helix-universal-logger');
const { wrap: status } = require('@adobe/helix-status');
const fetchAPI = require('@adobe/helix-fetch');

/* istanbul ignore next */
const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1
  ? fetchAPI.context({
    alpnProtocols: [fetchAPI.ALPN_HTTP1_1],
  })
  : fetchAPI;

function getMdInfo(host, path, log) {
  let mdPath;
  const file = path.split('/').pop() || 'index'; // use 'index' if no filename
  if (file.endsWith('.html')) {
    mdPath = path.replace(/\.html$/, '.md');
  } else if (!file.includes('.')) {
    mdPath = `${path.endsWith(file) ? path : `${path}${file}`}.md`;
  }
  if (!mdPath) {
    log.debug('Not an html document, so no markdown purging required');
    return {};
  }
  const [projectInfo] = host.split('.');
  const ghDetails = projectInfo.split('.')[0].split('--');
  const owner = ghDetails.pop();
  const repo = ghDetails.pop();
  const branch = ghDetails[0] || 'master';
  return {
    host: `${branch}--${repo}--${owner}.hlx.page`,
    path: mdPath,
  };
}

async function purge(host, path, log, exact) {
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
      results.push(await purge(host, `${path}index`, log, true));
      results.push(await purge(host, `${path}index.html`, log, true));
    } else {
      if (file === 'index' || file === 'index.html') {
        // index(.html), also purge directory
        results.push(await purge(host, path.substring(0, path.lastIndexOf('/') + 1), log, true));
      }
      if (file.endsWith('.html')) {
        // file with .html extension, also purge without extension
        results.push(await purge(host, path.substring(0, path.lastIndexOf('.')), log, true));
      } else if (!file.includes('.')) {
        // file without extension, also purge with .html extension
        results.push(await purge(host, `${path}.html`, log, true));
      }
    }
  }
  return results.length === 1 ? results[0] : results;
}

async function purgeInner(host, path, log) {
  const results = [];
  // check host validity
  if (host.endsWith('.page') && host.includes('--')) {
    const { host: mdHost, path: mdPath } = getMdInfo(host, path, log);
    if (mdHost && mdPath) {
      // first purge markdown
      results.push(await purge(mdHost, mdPath, log, true));
    }
    results.push(await purge(host, path, log));
  } else {
    log.warn(`invalid inner CDN host: ${host}`);
    results.push({ status: 'error', url: `https://${host}${path}` });
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

  const { log } = context;

  let results = [];

  if (host) {
    results.push(await purgeInner(
      host,
      path,
      log,
    ));
  } else {
    log.warn('Not purging inner CDN due to missing host parameter');
  }
  results.push(...await Promise.all(Array.from(new Set(xfh
    .split(',')
    .map((fwhost) => fwhost.trim())
    .filter((fwhost) => !!fwhost)))
    .filter((fwhost) => fwhost !== host) // skip inner CDN host
    .map((fwhost) => purge(fwhost, path, log))));
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

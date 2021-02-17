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

async function purgeInner(host, path, service, token, log) {
  const url = `https://${host}${path}`;
  try {
    const f = Fastly(token, service);
    const surrogateKey = utils.computeSurrogateKey(url.replace(/\?.*$/, ''));
    log.info('Purging inner CDN with surrogate key', surrogateKey);
    await f.purgeKey(surrogateKey);
  } catch (e) {
    log.error('Unable to purge inner CDN', e);
    return { status: 'error', url };
  }
  return { status: 'ok', url };
}

async function purgeOuter(host, path, log, exact) {
  const url = `https://${host}${path}`;
  log.info('Purging', url);
  try {
    const res = await fetch(url, {
      method: 'PURGE',
    });
    const msg = await res.text();
    log.debug(msg);
    if (!res.ok) {
      throw new Error(msg);
    }
  } catch (e) {
    log.error('Unable to purge outer CDN', e);
    return { status: 'error', url };
  }
  if (!exact) {
    if (path.endsWith('.html')) {
      // if .html extension, also purge URL without it
      await purgeOuter(host, path.substring(0, path.lastIndexOf('.')), log, true);
    } else if (!path.split('/').pop().includes('.')) {
      // if no extension, also purge URL with .html extension
      await purgeOuter(host, `${path}.html`, log, true);
    }
  }
  return { status: 'ok', url };
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

  const results = [];

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
    .filter((fwhost) => !!fwhost)
    .map((fwhost) => purgeOuter(fwhost, path, log))));

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

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
const { epsagon } = require('@adobe/helix-epsagon');
const Fastly = require('@adobe/fastly-native-promises');
const { utils } = require('@adobe/helix-shared');
const fetchAPI = require('@adobe/helix-fetch');

/* istanbul ignore next */
const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1

  ? fetchAPI.context({
    alpnProtocols: [fetchAPI.ALPN_HTTP1_1],
  })
  : fetchAPI;
const commence = require('./stop');

function retry(num, log) {
  let attempt = 0;
  return async (fn) => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await fn();
        log.debug(`Succeeding after ${attempt} attempts`);
        return res;
      } catch (e) {
        attempt += 1;
        if (attempt >= num) {
          log.debug(`Failing after ${attempt} attempts`);
          throw e;
        }
      }
    }
  };
}

async function purgeInner(host, path, service, token, log) {
  const url = `https://${host}${path}`;
  try {
    const f = Fastly(token, service);
    const surrogateKey = utils.computeSurrogateKey(url.replace(/\?.*$/, ''));
    log.info('Purging inner CDN with surrogate key', surrogateKey);
    await retry(10, log)(() => f.purgeKeys([surrogateKey]));
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
    log.debug(await res.text());
    if (!res.ok) {
      throw new Error(await res.text());
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
 * @param {string} name name of the person to greet
 * @returns {object} a greeting
 */
async function main({
  host, xfh = '', path = '', HLX_PAGES_FASTLY_SVC_ID, HLX_PAGES_FASTLY_TOKEN, __ow_logger: log,
}) {
  const results = [];

  if (!(await commence(log))) {
    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        status: 'error',
        message: 'Refusing to purge while Helix Pages responses are inconsistent. Check status.project-helix.io for details.',
      },
    };
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
    .filter((fwhost) => fwhost !== host))) // skip inner CDN host
    .map((fwhost) => purgeOuter(fwhost, path, log))));

  if (results.length === 0) {
    return {
      statusCode: 204,
      headers: {
        'Content-Type': 'application/json',
      },
      body: results,
    };
  }
  if (!results.find((r) => r.status !== 'ok')) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: results,
    };
  }

  return {
    statusCode: 207,
    headers: {
      'Content-Type': 'application/json',
    },
    body: results,
  };
}

module.exports.main = wrap(main)
  .with(epsagon)
  .with(status)
  .with(logger.trace)
  .with(logger);

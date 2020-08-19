/*
 * Copyright 2019 Adobe. All rights reserved.
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
const { fetch } = require('@adobe/helix-fetch').context({
  httpsProtocols:
  /* istanbul ignore next */
    process.env.HELIX_FETCH_FORCE_HTTP1 ? ['http1'] : ['http2', 'http1'],
});

async function purgeInner(host, path, service, token, log) {
  const url = `https://${host}${path}`;
  try {
    const f = Fastly(token, service);
    await f.purgeKeys([utils.computeSurrogateKey(url)]);
  } catch (e) {
    log.error('Unable to purge inner CDN', e);
    return { status: 'error', url };
  }
  return { status: 'ok', url };
}

async function purgeOuter(host, path, log) {
  const url = `https://${host}${path}`;
  try {
    const res = await fetch(url, {
      method: 'PURGE',
    });
    log.debug(res.text);
    if (!res.ok) {
      log.error('Unable to purge outer CDN', res.text);
      return { status: 'error', url };
    }
  } catch (e) {
    log.error('Unable to purge outer CDN', e);
    return { status: 'error', url };
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

  results.push(...await Promise.all(xfh
    .split(',')
    .map(fwhost => fwhost.trim())
    .filter(fwhost => !!fwhost)
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

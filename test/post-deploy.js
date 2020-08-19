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

/* eslint-env mocha */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const chaiHttp = require('chai-http');
const packjson = require('../package.json');

chai.use(chaiHttp);
const { expect } = chai;

function getbaseurl() {
  const namespace = 'helix';
  const package = 'helix-services';
  const name = packjson.name.replace('@adobe/helix-', '');
  let version = `${packjson.version}`;
  if (process.env.CI && process.env.CIRCLE_BUILD_NUM && process.env.CIRCLE_BRANCH !== 'master') {
    version = `ci${process.env.CIRCLE_BUILD_NUM}`;
  }
  return `api/v1/web/${namespace}/${package}/${name}@${version}`;
}

describe('Post-Deploy Tests', () => {
  it('Purge a blog post', async () => {
    // eslint-disable-next-line no-console
    console.log(`Trying https://adobeioruntime.net/${getbaseurl()}?host=theblog--adobe.hlx.page&xfh=blog.adobe.com&path=/en/2020/08/14/6-ways-ta-adapt-advance-your-business-during-pandemic.html`);

    await chai
      .request('https://adobeioruntime.net/')
      .get(`${getbaseurl()}?host=theblog--adobe.hlx.page&xfh=blog.adobe.com&path=/en/2020/08/14/6-ways-ta-adapt-advance-your-business-during-pandemic.html`)
      .then((response) => {
        expect(response).to.have.status(200);
        expect(response).to.be.json;
        expect(response.body).to.be.an('array');
        expect(response.body).to.have.a.lengthOf(2);
      }).catch((e) => {
        throw e;
      });
  }).timeout(10000);
});

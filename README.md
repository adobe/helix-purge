# Helix Purge

> Purge two CDNs at once

## Status
[![codecov](https://img.shields.io/codecov/c/github/adobe/helix-purge.svg)](https://codecov.io/gh/adobe/helix-purge)
[![CircleCI](https://img.shields.io/circleci/project/github/adobe/helix-purge.svg)](https://circleci.com/gh/adobe/helix-purge)
[![GitHub license](https://img.shields.io/github/license/adobe/helix-purge.svg)](https://github.com/adobe/helix-purge/blob/master/LICENSE.txt)
[![GitHub issues](https://img.shields.io/github/issues/adobe/helix-purge.svg)](https://github.com/adobe/helix-purge/issues)
[![LGTM Code Quality Grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/adobe/helix-purge.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/adobe/helix-purge)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Installation

## Usage

```bash
curl -X POST https://adobeioruntime.net/api/v1/web/helix/helix-services/purge@v1?host=…&xfh=…&path=…
```

- `host`: the inner cdn hostname
- `xfh`: the outer cdn hostnames, comma separated
- `path`: the path to purge

For more, see the [API documentation](docs/API.md).

## Development

### Deploying Helix Purge

Deploying Helix Purge requires the `wsk` command line client, authenticated to a namespace of your choice. For Project Helix, we use the `helix` namespace.

All commits to master that pass the testing will be deployed automatically. All commits to branches that will pass the testing will get commited as `/helix-services/purge@ci<num>` and tagged with the CI build number.

## Operations

To temporarily stop purges, edit [`OK.md`](OK.md), so that it says "not ok".
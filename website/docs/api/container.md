# Container API

This API allows to query the state of the watched containers.

## Get all containers

This operation lets you get all the watched cainers.

```bash
curl http://wud:3000/api/containers

[
   {
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5",
    "created":"2021-06-13T05:33:38.440Z"
  },
  "resultSelection":{
    "mode":"auto"
  },
  "results":[
    {
      "tag":"2021.6.6",
      "created":"2021-06-13T06:33:38.440Z",
      "updateKind":{
        "kind":"tag",
        "localValue":"2021.6.4",
        "remoteValue":"2021.6.6",
        "semverDiff":"patch"
      },
      "updateAvailable":false,
      "updatePending":true,
      "updatePendingReason":"minimum-age",
      "updatePendingUntil":"2021-06-13T18:33:38.440Z",
      "selected":false
    },
    {
      "tag":"2021.6.5",
      "created":"2021-06-13T05:33:38.440Z",
      "updateKind":{
        "kind":"tag",
        "localValue":"2021.6.4",
        "remoteValue":"2021.6.5",
        "semverDiff":"patch"
      },
      "updateAvailable":false,
      "updatePending":true,
      "updatePendingReason":"minimum-age",
      "updatePendingUntil":"2021-06-13T17:33:38.440Z",
      "selected":true
    }
  ],
  "minAge":"12h",
  "updateAvailable": false,
  "updatePending": true,
  "updatePendingReason":"minimum-age",
  "updatePendingUntil":"2021-06-13T17:33:38.440Z"
}
]
```

?> When `updatePending` is `true`, the candidate is visible but is not pullable yet. `updateAvailable` becomes `true` only after the pending window has elapsed.

?> `result` remains the selected candidate used by triggers and update actions. `results` is additive and lists every eligible newer candidate found for the container, including per-candidate status and update kind. Digest-only candidates may expose `digest` without a `tag`; the tag is still preserved on `result` for backward-compatible automation.

?> `resultSelection.mode` is `auto` by default. When a user manually selects a candidate, `mode` becomes `manual` and `result` mirrors that candidate. The manual selection is kept while the same newest candidate is still known; when a newer candidate is discovered, WUD resets the selection to `auto` so the newer update can be used.

## Watch all Containers

This operation triggers a manual watch on all containers.

```bash
curl -X POST http://wud:3000/api/containers/watch

[{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}]
```

## Get a Container by id

This operation lets you get a container by id.

```bash
curl http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816

{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}
```

## Select a Container Result Candidate

This operation lets you select one candidate from the container `results` list. The selected candidate becomes the container `result` used by triggers and update actions.

```bash
curl -X PUT http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816/result-selection \
  -H "Content-Type: application/json" \
  -d '{"mode":"manual","tag":"2021.6.5"}'

{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "result":{
    "tag":"2021.6.5"
  },
  "resultSelection":{
    "mode":"manual",
    "tag":"2021.6.5",
    "baselineTag":"2021.6.6"
  }
}
```

Use `tag`, `digest`, and/or `created` to identify the candidate. The request returns `400` when the candidate is not present in `results`.

## Reset Container Result Selection

This operation returns the container to automatic result selection.

```bash
curl -X DELETE http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816/result-selection

{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "resultSelection":{
    "mode":"auto"
  }
}
```

## Get all triggers associated to the container

This operation lets you get the list of the containers associated to the container.

```bash
curl http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816/triggers

[
  {
    "id": "ntfy.one",
    "type": "ntfy",
    "name": "one",
    "configuration": {
      "topic": "235ef38e-f1db-414a-964f-ce3f2cc8094d",
      "url": "https://ntfy.sh",
      "threshold": "major",
      "mode": "simple",
      "once": true,
      "simpletitle": "New ${kind} found for container ${name}",
      "simplebody": "Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}",
      "batchtitle": "${containers.length} updates available",
    }
  }
]
```

## Watch a Container

This operation triggers a manual watch on a container.

```bash
curl -X POST http://wud:3000/api/containers/ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72/watch

{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}
```

## Run a trigger on the container

This operation lets you manually run a trigger on the container.

```bash
curl -X POST http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816/triggers/ntfy/one
```

## Delete a Container

This operation lets you delete a container by id.

```bash
curl -X DELETE http://wud:3000/api/containers/ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72
```

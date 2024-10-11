import * as http from 'node:http'
import {coreHandlers} from "./lib/coreHandlers.js";
import {getConfiguredHandlersSharedState, isDebug, port} from "./lib/sharedState.js";
import {getCurrentTime} from "./lib/utils.js";

const configuredHandlers = getConfiguredHandlersSharedState()

function oldestLastUsedFirst(l, r) {
  if (l.lastUsedDate > r.lastUsedDate) {
    return 1
  }
  if (l.lastUsedDate < r.lastUsedDate) {
    return -1
  }
  return 0
}

function queryStringFromObject(queryObj) {
  if (!queryObj) {
    return ''
  }
  const qs = Object.keys(queryObj).map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(queryObj[key])}`).join('&')
  return qs.length > 0 ? `?${qs}` : ''
}

function queryObjectFromString(queryString) {
  if (!queryString || queryString === '') {
    return undefined
  }
  return Object.fromEntries((queryString || '').split('&').map(pair => pair.split('=').map(decodeURIComponent)))
}

function queryObjectsMatch(actualQO, configuredQO) {
  const sanitisedActualQO = actualQO || {}

  if (!configuredQO) {
    return true
  }
  const result = !Object.keys(configuredQO).find((key) => ('' + sanitisedActualQO[key]) !== ('' + configuredQO[key]))
  // console.log(`result [${result}] comparing [${JSON.stringify(configuredQO)}] and [${JSON.stringify(sanitisedActualQO)}]`)
  return result
}

function objectsDeepEqual(l, r, {allowArraysInAnyOrder = true} = {}) {
  if (Object.keys(l).length !== Object.keys(r).length) {
    return false
  }

  function itemsMatch(l, r) {
    if (typeof l === 'object') {
      return objectsDeepEqual(l, r)
    }

    return r.includes(l)
  }

  if (allowArraysInAnyOrder && Array.isArray(l)) {
    if (!Array.isArray(r) || l.length !== r.length) {
      return false
    }
    for (const key in l) {
      if (r.filter(x => itemsMatch(l[key], x)).length === 0) {
        return false
      }
    }
    return true
  }
  for (const key in l) {
    if (typeof l[key] === 'object') {
      if (!objectsDeepEqual(l[key], r[key])) {
        return false
      }
    } else if (r[key] !== l[key]) {
      return false
    }
  }
  return true
}

function bodyObjectsMatch(actualBody, configuredBody) {
  if (configuredBody === undefined) {
    return true
  }
  return objectsDeepEqual(actualBody, configuredBody)
}

function getFullUrl(url, queryObj) {
  return url + queryStringFromObject(queryObj)
}

const defaultHandler = (req) => {
  if (configuredHandlers.__default__) {
    return configuredHandlers.__default__
  }

  return {
    statusCode: 200,
    body: undefined
  }
}

function getHandlerForRequest({method, url, queryObj, body}) {
  if (coreHandlers[method] && coreHandlers[method][url]) {
    return coreHandlers[method][url]
  }
  if (configuredHandlers[method] && configuredHandlers[method][url] && configuredHandlers[method][url].length > 0) {
    const handlers = configuredHandlers[method][url]
    const filtered = handlers.filter(conf => queryObjectsMatch(queryObj, conf.queryObj)).filter(conf => bodyObjectsMatch(body, conf.bodyObj))
    if (filtered.length > 0) {
      const foundHandler = filtered.sort(oldestLastUsedFirst)[0]
      foundHandler.lastUsedDate = getCurrentTime()
      if (isDebug) {
        console.log('handling request:', {method, url, queryObj, body, foundHandler})
      }
      return () => foundHandler
    }
  }

  if (isDebug) {
    console.log('Configured handlers (on 404)', configuredHandlers)
  }

  const availableUrls = new Set()
  const urls = Object.keys(configuredHandlers[method] || {})
  urls.forEach(url => {
    configuredHandlers[method][url].forEach(config => {
      availableUrls.add(getFullUrl(url, config.queryObj))
    })
  })
  if (isDebug) {
    console.log('')
    console.log('- - -')
    console.log('')
    console.log(`No [${method}] handler found for URL:`)
    console.log('')
    console.log(getFullUrl(url, queryObj))
    if (body) {
      console.log('')
      console.log('With body:')
      console.log('')
      console.log(JSON.stringify(body, null, 2))
    }
    console.log('')
    console.log('Available urls:')
    availableUrls.forEach(url => console.log(` - ${url}`))
    console.log('')
    console.log('- - -')
    console.log('')
  }

  return defaultHandler
}

function issueErrorResponse(err, responseInitiated, res) {
  console.error(err)
  if (!responseInitiated) {
    res.writeHead(500, {'Content-Type': 'application/json'})
  }
  res.end(JSON.stringify({
    error: true,
    rawError: {
      message: err.message,
      type: err.type,
      stack: err.stack,
      request: err.request,
      result: err.result
    }
  }))
}

function _validateResultRaw(result) {
  const reasonsForRejection = []
  if (typeof result === 'undefined') {
    return ['Result was undefined, you must return an object from you handler function']
  }
  if (typeof result !== 'object') {
    return ['Result was not an object, you must return an object from you handler function']
  }
  if (typeof result.statusCode !== 'number') {
    reasonsForRejection.push('statusCode must be a number')
  } else if (result.statusCode < 100 || result.statusCode >= 600) {
    reasonsForRejection.push('statusCode must be in range')
  }
  return reasonsForRejection
}

function resultIsValid(result) {
  return _validateResultRaw(result).length === 0
}

function getValidationExplanationForRequest(result) {
  const rawResults = _validateResultRaw(result)
  if (rawResults.length === 0) {
    return 'Something went wrong while validating :('
  }
  return rawResults.join(', ')
}

function getHeadersFromResult(result) {
  const headers = typeof result?.body === 'object' ? {'Content-Type': 'application/json'} : {}
  Object.keys(result?.headers || {}).forEach(key => {
    headers[key] = result.headers[key]
  })
  return headers
}

const server = http.createServer((req, res) => {
  const bodyParts = []
  let responseInitiated = false

  req.on('data', (chunk) => {
    bodyParts.push(chunk.toString())
  })

  req.on('end', () => {
    try {
      let body
      if (bodyParts.length > 0) {
        if ((req.headers['content-type'] || '').includes('application/json')) {
          body = JSON.parse(bodyParts.join(''))
        } else {
          body = bodyParts.join('')
        }
      }
      const [url, queryString] = req.url.split('?')
      const request = {
        method: req.method || 'GET',
        url,
        headers: req.headers,
        queryObj: queryObjectFromString(queryString),
        body
      }

      const handler = getHandlerForRequest(request)
      const result = handler(request)

      if (!resultIsValid(result)) {
        const error = new Error(`Invalid result for request, ${getValidationExplanationForRequest(result)}`)
        error.request = request
        error.result = result
        issueErrorResponse(error, false, res)
      } else {
        res.writeHead(result.statusCode, getHeadersFromResult(result))
        responseInitiated = true

        if (typeof result.body === 'object') {
          res.end(JSON.stringify(result.body))
        } else if (result.body) {
          res.end(result.body)
        } else {
          res.end()
        }
      }
    } catch (err) {
      issueErrorResponse(err, responseInitiated, res)
    }
  })
})

server.listen(port)

console.log('running http configurable mock server on port', port)

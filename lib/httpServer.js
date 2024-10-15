import * as http from 'node:http'
import { getResultForRequest } from './mockRequestHandling.js'
import { port } from './sharedState.js'

export function startHttpServer () {
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

        const result = getResultForRequest(request)

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

  console.log('running run-amock http server on port', port)
}

function issueErrorResponse (err, responseInitiated, res) {
  console.error(err)
  if (!responseInitiated) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
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

function queryObjectFromString (queryString) {
  if (!queryString || queryString === '') {
    return undefined
  }
  return Object.fromEntries((queryString || '')
    .split('&')
    .filter(x => !!x)
    .map(pair => pair.split('=').map(decodeURIComponent)))
}

function resultIsValid (result) {
  return _validateResultRaw(result).length === 0
}

function _validateResultRaw (result) {
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

function getValidationExplanationForRequest (result) {
  const rawResults = _validateResultRaw(result)
  if (rawResults.length === 0) {
    return 'Something went wrong while validating :('
  }
  return rawResults.join(', ')
}

function getHeadersFromResult (result) {
  const headers = typeof result?.body === 'object' ? { 'Content-Type': 'application/json' } : {}
  Object.keys(result?.headers || {}).forEach(key => {
    headers[key] = result.headers[key]
  })
  return headers
}

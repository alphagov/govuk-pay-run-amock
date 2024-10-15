import { getConfiguredHandlersSharedState, isDebug } from './sharedState.js'
import { getCurrentTime } from './utils.js'

const configuredHandlers = getConfiguredHandlersSharedState()

const addMocksEndpoint = (request) => {
  const requestBody = request.body
  if (isDebug) {
    console.log('Request body adding mock endpoints:')
    console.log(JSON.stringify(requestBody))
  }
  const stubs = requestBody.stubs
  if (!stubs) {
    return respondWith400('no stubs provided')
  }
  const errors = []
  if (requestBody.defaultResponse) {
    configuredHandlers.__default__ = requestBody.defaultResponse
  }
  stubs.forEach(({ predicates, responses }) => {
    if (!predicates) {
      return errors.push('no predicates provided (we require exactly one)')
    }
    if (predicates.length > 1) {
      return errors.push('too many predicates provided (we require exactly one)')
    }
    const predicate = predicates[0]
    if (!responses) {
      return errors.push(`no responses provided, input was [${JSON.stringify({ predicates, responses })}]`)
    }
    if (responses.length === 0) {
      return errors.push(`no responses provided in responses array, input was [${JSON.stringify({
        predicates,
        responses
      })}]`)
    }

    let predicateEquals, isDeepEquals

    if (predicate.deepEquals) {
      predicateEquals = predicate.deepEquals
      isDeepEquals = true
    } else if (predicate.equals) {
      predicateEquals = predicate.equals
      isDeepEquals = false
    } else {
      predicateEquals = {}
    }
    const { path, method, query, body: bodyObj } = predicateEquals

    if (!path) {
      return errors.push('predicate is missing path')
    }
    if (!method) {
      return errors.push('predicate is missing method')
    }
    const additionalKeys = Object.keys(predicateEquals).filter(x => !['path', 'method', 'query', 'body', 'headers'].includes(x))
    if (additionalKeys.length > 0) {
      return errors.push(`unexpected keys for predicate [${method}] [${path}], [${additionalKeys.join(', ')}]`)
    }
    if (!configuredHandlers[method]) {
      configuredHandlers[method] = {}
    }
    responses.forEach(response => {
      if (!response.is) {
        return errors.push(`We only handle responses.is, keys provided [${Object.keys(responses).join(', ')}]`)
      }
      const statusCode = response.is.statusCode
      if (!statusCode) {
        return errors.push('No status code provided')
      }
      const body = response.is.body
      const headers = response.is.headers
      if (!configuredHandlers[method][path]) {
        configuredHandlers[method][path] = []
      }
      const lastUsedDate = getCurrentTime()
      configuredHandlers[method][path].push({
        statusCode,
        body,
        queryObj: stringifyQueryObject(query),
        bodyObj,
        lastUsedDate,
        headers,
        isDeepEquals
      })
    })
  })
  if (errors.length > 0) {
    console.error('Errors when setting up handlers', errors)
    return respondWith400(`There were errors handling your stub setup: ${errors.join(', ')}`)
  } else {
    return {
      statusCode: 201,
      body: {
        setupSuccessful: true
      }
    }
  }
}
const clearMocksEndpoint = () => {
  Object.keys(configuredHandlers).forEach(key => {
    delete configuredHandlers[key]
  })
  return {
    statusCode: 200,
    body: {
      cleared: true
    }
  }
}

export const coreHandlers = {
  POST: {
    '/__add-mock-endpoints__': addMocksEndpoint,
    '/__clear-mock-endpoints__': clearMocksEndpoint
  }
}

function stringifyQueryObject (obj) {
  if (!obj) {
    return obj
  }
  const output = {}
  Object.keys(obj).forEach(key => {
    output[key] = ('' + obj[key])
  })
  return output
}

function respondWith400 (reason) {
  return {
    statusCode: 400,
    body: {
      error: true,
      message: reason
    }
  }
}

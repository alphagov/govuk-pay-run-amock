import * as net from 'node:net'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as assert from 'node:assert'
import {imposterClearUrl, imposterSetupUrl} from "./constants.js";
import {httpPostJson, httpPatchJson} from "./utils.js";

async function findAvailablePort () {
  return await new Promise((resolve) => {
    let port
    const tmpServer = net.createServer(function (sock) {
      sock.end('Hello world\n')
    })
    tmpServer.listen(0, function () {
      port = tmpServer.address().port
      tmpServer.close(() => {
        resolve(port)
      })
    })
  })
}

const mockPort = await findAvailablePort()
const mountebankConfig = {
  name: 'mountebank',
  imposterSetupUrl: 'http://localhost:2525/imposters',
  imposterClearUrl: 'http://localhost:2525/imposters',
  imposterClearMethod: 'DELETE',
  mockedHttpBaseUrl: `http://localhost:${mockPort}`,
  mockPort
}
const selfConfig = {
  name: 'run-amock',
  imposterSetupUrl,
  imposterClearUrl,
  imposterClearMethod: 'POST',
  mockedHttpBaseUrl: 'http://localhost:9999',
  mockPort: 9999
}

async function clearAllMocks (config) {
  const result = await fetch(config.imposterClearUrl, { method: config.imposterClearMethod })
  assert.equal(200, result.status, `Failed to clear all mocks, status code [${result.status}], body [${await result.text()}]`)
}

async function setupImposters (config, imposterSetupBody) {
  const setupResult = await httpPostJson(config.imposterSetupUrl, imposterSetupBody)
  const setupResultBody = await setupResult.text()
  assert.equal(201, setupResult.status, `failed setup, status code: [${setupResult.status}], response body: [${setupResultBody}]`)
}

function jsonString (main, ...parts) {
  const outParts = []
  main.forEach((item, index) => {
    outParts.push(item)
    if (parts[index] !== undefined) {
      outParts.push(JSON.stringify(parts[index]))
    }
  })
  return outParts.join('')
}

const testRunConfigs = []

if (process.env.TEST_MB === 'true') {
  testRunConfigs.push(mountebankConfig)
}
if (process.env.TEST_SELF !== 'false') {
  testRunConfigs.push(selfConfig)
}

testRunConfigs.forEach(config => {
  beforeEach(async () => {
    await clearAllMocks(config)
  })
  afterEach(async () => {
    await clearAllMocks(config)
  })
  describe('equality-with-mountebank', () => {
    it(`should give one response multiple times, and respect deletes (${config.name})`, async () => {
      const fakeBody = {
        abc: 'def'
      }
      const statusCode = 200
      const path = '/a'
      await setupImposters(config, {
        port: mockPort,
        protocol: 'http',
        stubs: [
          {
            name: `The name doesn't matter (unique: ${Math.random()})`,
            predicates: [
              {
                deepEquals: {
                  method: 'GET',
                  path
                }
              }
            ],
            responses: [
              {
                is: {
                  statusCode,
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: fakeBody
                }
              }
            ]
          }
        ]
      })

      let remainingRequests = 5
      const fullMockUrl = config.mockedHttpBaseUrl + path
      while (remainingRequests-- > 0) {
        const result = await fetch(fullMockUrl)
        const responseBody = await result.json()
        const responseStatusCode = result.status

        assert.equal(statusCode, responseStatusCode, `Response from [${fullMockUrl}] was [${responseStatusCode}], expected [${statusCode}]`)
        assert.deepEqual(fakeBody, responseBody)
      }
      await clearAllMocks(config)
      try {
        const resultAfterDelete = await fetch(fullMockUrl)
        const statusAfterDelete = resultAfterDelete.status

        assert.equal(404, statusAfterDelete, `Response from [${fullMockUrl}] was [${statusAfterDelete}], expected [404]`)
      } catch (error) {
        // ignoring because an error is one valid way to handle this
      }
    })
    it(`should alternate between two responses (${config.name})`, async () => {
      const fakeBody1 = {
        abc: 'def'
      }
      const fakeBody2 = {
        ghi: 'jkl'
      }
      const imposterSetupBody = {
        port: mockPort,
        protocol: 'http',
        stubs: [
          {
            name: `The name doesn't matter (unique: ${Math.random()})`,
            predicates: [
              {
                deepEquals: {
                  method: 'GET',
                  path: '/b'
                }
              }
            ],
            responses: [
              {
                is: {
                  statusCode: 200,
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: fakeBody1
                }
              },
              {
                is: {
                  statusCode: 200,
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: fakeBody2
                }
              }
            ]
          }
        ]
      }

      await setupImposters(config, imposterSetupBody)

      let counter = 0
      const fullMockUrl = config.mockedHttpBaseUrl + '/b'
      while (counter++ < 5) {
        const result1 = await fetch(fullMockUrl)
        const responseBody1 = await result1.json()
        const responseStatusCode1 = result1.status

        assert.equal(200, responseStatusCode1, `Response from [${fullMockUrl}] was [${responseStatusCode1}], expected [${200}]`)
        assert.deepEqual(fakeBody1, responseBody1, jsonString`Expected response body (1) (repeat counter: [${counter}]) [${responseBody1}] to equal the configured output [${fakeBody1}]`)

        const result2 = await fetch(fullMockUrl)
        const responseBody2 = await result2.json()
        const responseStatusCode2 = result2.status

        assert.equal(200, responseStatusCode2, `Response from [${fullMockUrl}] was [${responseStatusCode1}], expected [${200}]`)
        assert.deepEqual(fakeBody2, responseBody2, jsonString`Expected response body (2) (repeat counter: [${counter}]) [${responseBody2}] to equal the configured output [${fakeBody2}]`)
      }
    })
  })
  it(`should respond with the default response when configured (${config.name})`, async () => {
    const fakeBody = 'No stub predicate matches the request'
    const statusCode = 404
    await setupImposters(config, {
      port: mockPort,
      protocol: 'http',
      defaultResponse: { statusCode, body: fakeBody, headers: {} },
      stubs: []
    })

    const fullMockUrl = config.mockedHttpBaseUrl + '/abc'
    const result = await fetch(fullMockUrl)
    const responseBody = await result.text()
    const responseStatusCode = result.status

    assert.equal(statusCode, responseStatusCode, `Response from [${fullMockUrl}] was [${responseStatusCode}], expected [${statusCode}]`)
    assert.deepEqual(fakeBody, responseBody)
  })
  it(`should allow deep query string matching in predicates (${config.name})`, async () => {
    const url = '/example'
    await setupImposters(config, {
      port: mockPort,
      protocol: 'http',
      defaultResponse: { statusCode: 404, body: 'Default 404', headers: {} },
      stubs: [
        {
          name: `The name doesn't matter (unique: ${Math.random()})`,
          predicates: [
            {
              deepEquals: {
                method: 'GET',
                path: url,
                query: {
                  a: 'b',
                  c: 'd',
                  e: 'f'
                }
              }
            }
          ],
          responses: [
            {
              is: {
                statusCode: 200,
                headers: {
                  'Content-Type': 'application/json'
                },
                body: {
                  hello: 'world'
                }
              }
            }
          ]
        }
      ]
    })

    const fullMockUrl = config.mockedHttpBaseUrl + url
    const acceptableQueryStrings = [
      'a=b&c=d&e=f',
      'e=f&a=b&c=d',
      'e=f&a=b&c=d&'
    ]
    const unacceptableQueryStrings = [
      'something=true&a=b&example=here&c=d&hello=world&e=f',
      'a=b&c=d&e=g',
      'a=c&c=d&e=g'
    ]
    await Promise.all(acceptableQueryStrings.map(async (queryString) => {
      const successResult = await fetch(fullMockUrl + '?' + queryString)

      assert.equal(200, successResult.status, `Expected a success response from [${fullMockUrl}], got a [${successResult.status}] for query string [${queryString}]`)
    }))
    await Promise.all(unacceptableQueryStrings.map(async (queryString) => {
      const successResult = await fetch(fullMockUrl + '?' + queryString)

      assert.equal(404, successResult.status, `Expected a failure response from [${fullMockUrl}], got a [${successResult.status}] for query string [${queryString}]`)
    }))
  })
  it(`should type correct query strings (${config.name})`, async () => {
    const url = '/example'
    await setupImposters(config, {
      port: mockPort,
      protocol: 'http',
      defaultResponse: { statusCode: 404, body: 'Default 404', headers: {} },
      stubs: [
        {
          name: `The name doesn't matter (unique: ${Math.random()})`,
          predicates: [
            {
              deepEquals: {
                method: 'GET',
                path: url,
                query: {
                  agreement_id: 'a-valid-agreement-id',
                  display_size: 5,
                  account_id: 10,
                  page: 1,
                  limit_total: true,
                  limit_total_size: 5001
                }
              }
            }
          ],
          responses: [
            {
              is: {
                statusCode: 200,
                headers: {
                  'Content-Type': 'application/json'
                },
                body: {
                  hello: 'world'
                }
              }
            }
          ]
        }
      ]
    })

    const queryString = '?account_id=10&limit_total=true&limit_total_size=5001&agreement_id=a-valid-agreement-id&page=1&display_size=5'
    const fullMockUrl = config.mockedHttpBaseUrl + url + queryString
    const successResult = await fetch(fullMockUrl)

    assert.equal(200, successResult.status, `Expected a success response from [${fullMockUrl}], got a [${successResult.status}] for query string [${queryString}]`)
  })
  it(`should allow partial query string matching in predicates (${config.name})`, async () => {
    const url = '/example'
    await setupImposters(config, {
      port: mockPort,
      protocol: 'http',
      defaultResponse: { statusCode: 404, body: 'Default 404', headers: {} },
      stubs: [
        {
          name: `The name doesn't matter (unique: ${Math.random()})`,
          predicates: [
            {
              equals: {
                method: 'GET',
                path: url,
                query: {
                  a: 'b',
                  c: 'd',
                  e: 'f'
                }
              }
            }
          ],
          responses: [
            {
              is: {
                statusCode: 200,
                headers: {
                  'Content-Type': 'application/json'
                },
                body: {
                  hello: 'world'
                }
              }
            }
          ]
        }
      ]
    })

    const fullMockUrl = config.mockedHttpBaseUrl + url
    const acceptableQueryStrings = [
      'a=b&c=d&e=f',
      'e=f&a=b&c=d',
      'e=f&a=b&c=d&',
      'something=true&a=b&example=here&c=d&hello=world&e=f'
    ]
    const unacceptableQueryStrings = [
      'a=b&c=d&e=g',
      'a=c&c=d&e=g'
    ]
    await Promise.all(acceptableQueryStrings.map(async (queryString) => {
      const successResult = await fetch(fullMockUrl + '?' + queryString)

      assert.equal(200, successResult.status, `Expected a success response from [${fullMockUrl}], got a [${successResult.status}]`)
    }))
    await Promise.all(unacceptableQueryStrings.map(async (queryString) => {
      const successResult = await fetch(fullMockUrl + '?' + queryString)

      assert.equal(404, successResult.status, `Expected a failure response from [${fullMockUrl}], got a [${successResult.status}]`)
    }))
  })
  it(`should allow deep body matching in predicates (${config.name})`, async () => {
    const uri = '/v1/api/services/a-service-external-id'
    await setupImposters(config, {
      port: mockPort,
      protocol: 'http',
      defaultResponse: { statusCode: 404, body: 'No stub predicate matches the request', headers: {} },
      stubs: [{
        name: `The name doesn't matter (unique: ${Math.random()})`,
        predicates: [
          {
            deepEquals: {
              method: 'PATCH',
              path: uri,
              body: {
                op: 'replace',
                path: 'default_billing_address_country',
                value: 'GB'
              }
            }
          }
        ],
        responses: [
          {
            is: {
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json'
              },
              body: {
                matched: true
              }
            }
          }
        ]
      }]
    })

    const accepatableBodies = [
      {
        op: 'replace',
        path: 'default_billing_address_country',
        value: 'GB'
      }
    ]
    const fullMockUrl = config.mockedHttpBaseUrl + uri
    await Promise.all(accepatableBodies.map(async (body) => {
      const successResult = await httpPatchJson(fullMockUrl, body)

      assert.equal(200, successResult.status, `Expected a success response from [${fullMockUrl}], got a [${successResult.status}]`)
    }))
  })
  it(`should allow partial body matching in predicates (${config.name})`, async () => {
    const uri = '/v1/api/services/a-service-external-id'
    await setupImposters(config, {
      port: mockPort,
      protocol: 'http',
      defaultResponse: { statusCode: 404, body: 'No stub predicate matches the request', headers: {} },
      stubs: [{
        name: `The name doesn't matter (unique: ${Math.random()})`,
        predicates: [
          {
            equals: {
              method: 'PATCH',
              path: uri,
              body: {
                op: 'replace',
                path: 'default_billing_address_country',
                value: 'GB'
              }
            }
          }
        ],
        responses: [
          {
            is: {
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json'
              },
              body: {
                matched: true
              }
            }
          }
        ]
      }]
    })

    const accepatableBodies = [
      {
        op: 'replace',
        path: 'default_billing_address_country',
        value: 'GB'
      },
      {
        op: 'replace',
        path: 'default_billing_address_country',
        value: 'GB',
        extra: true
      }
    ]
    const fullMockUrl = config.mockedHttpBaseUrl + uri
    await Promise.all(accepatableBodies.map(async (body) => {
      const successResult = await httpPatchJson(fullMockUrl, body)

      assert.equal(200, successResult.status, `Expected a success response from [${fullMockUrl}], got a [${successResult.status}] for body [${JSON.stringify(body)}]`)
    }))

    const unacceptableBodies = [
      {
        op: 'replace',
        path: 'default_billing_address_country',
        extra: true
      }
    ]
    await Promise.all(unacceptableBodies.map(async (body) => {
      const successResult = await httpPatchJson(fullMockUrl, body)

      assert.equal(404, successResult.status, `Expected a failure response from [${fullMockUrl}], got a [${successResult.status}] for body [${JSON.stringify(body)}]`)
    }))
  })
  it(`should allow deep matching for body (${config.name})`, async () => {
    const uri = '/v1/api/accounts/42/credentials/101'
    await setupImposters(config, {
      port: mockPort,
      protocol: 'http',
      defaultResponse: { statusCode: 404, body: 'No stub predicate matches the request', headers: {} },
      stubs: [{
        name: `The name doesn't matter (unique: ${Math.random()})`,
        predicates: [
          {
            deepEquals: {
              method: 'PATCH',
              path: uri,
              body: [
                {
                  op: 'replace',
                  path: 'credentials/worldpay/recurring_customer_initiated',
                  value: {
                    username: 'a-cit-username',
                    password: 'a-password',
                    merchant_code: 'a-cit-merchant-code'
                  }
                },
                {
                  op: 'replace',
                  path: 'last_updated_by_user_external_id',
                  value: 'cd0fa54cf3b7408a80ae2f1b93e7c16e'
                }
              ]
            }
          }
        ],
        responses: [
          {
            is: {
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          }
        ]
      }
      ]
    })

    const acceptableBodies = [
      [
        {
          op: 'replace',
          path: 'credentials/worldpay/recurring_customer_initiated',
          value: {
            username: 'a-cit-username',
            password: 'a-password',
            merchant_code: 'a-cit-merchant-code'
          }
        },
        {
          op: 'replace',
          path: 'last_updated_by_user_external_id',
          value: 'cd0fa54cf3b7408a80ae2f1b93e7c16e'
        }
      ],
      [
        {
          path: 'credentials/worldpay/recurring_customer_initiated',
          op: 'replace',
          value: {
            password: 'a-password',
            username: 'a-cit-username',
            merchant_code: 'a-cit-merchant-code'
          }
        },
        {
          path: 'last_updated_by_user_external_id',
          op: 'replace',
          value: 'cd0fa54cf3b7408a80ae2f1b93e7c16e'
        }
      ],
      [
        {
          path: 'last_updated_by_user_external_id',
          op: 'replace',
          value: 'cd0fa54cf3b7408a80ae2f1b93e7c16e'
        },
        {
          path: 'credentials/worldpay/recurring_customer_initiated',
          op: 'replace',
          value: {
            password: 'a-password',
            username: 'a-cit-username',
            merchant_code: 'a-cit-merchant-code'
          }
        }
      ]
    ]
    const fullMockUrl = config.mockedHttpBaseUrl + uri
    await Promise.all(acceptableBodies.map(async (body) => {
      const successResult = await httpPatchJson(fullMockUrl, body)

      assert.equal(200, successResult.status, `Expected a success response from [${fullMockUrl}], got a [${successResult.status}]`)
    }))
    const unacceptableBodies = [
      [
        {
          path: 'credentials/worldpay/recurring_customer_initiated',
          op: 'replace',
          value: {
            password: 'a-password',
            username: 'a-cit-username',
            merchant_code: 'a-cit-merchant-code'
          }
        }
      ]
    ]
    await Promise.all(unacceptableBodies.map(async (body) => {
      const successResult = await httpPatchJson(fullMockUrl, body)

      assert.equal(404, successResult.status, `Expected a failure response from [${fullMockUrl}], got a [${successResult.status}]`)
    }))
  })
  it(`should work with Frontend tests for wallets (${config.name})`, async () => {
    const uri = '/v1/frontend/charges/ub8de8r5mh4pb49rgm1ismaqfv'
    await setupImposters(config, {
      port: mockPort,
      protocol: 'http',
      recordRequests: false,
      stubs: [
        {
          predicates: [
            {
              equals: {
                method: 'GET',
                path: uri
              }
            }
          ],
          responses: [
            {
              is: {
                statusCode: 200,
                headers: {
                  'Content-Type': 'application/json'
                },
                body: {
                  amount: 1000,
                  state: {
                    finished: false,
                    status: 'created'
                  },
                  description: 'Example fixture payment',
                  payment_provider: 'worldpay',
                  language: 'en',
                  status: 'CREATED',
                  charge_id: 'ub8de8r5mh4pb49rgm1ismaqfv',
                  return_url: '/humans.txt?confirm',
                  created_date: '2019-02-12T17:53:31.307Z',
                  delayed_capture: false,
                  moto: true,
                  gateway_account: {
                    gateway_account_id: 6,
                    allow_apple_pay: false,
                    allow_google_pay: true,
                    gateway_merchant_id: 'SMTHG12345UP',
                    analytics_id: 'an-analytics-id',
                    corporate_credit_card_surcharge_amount: 0,
                    corporate_debit_card_surcharge_amount: 0,
                    corporate_prepaid_debit_card_surcharge_amount: 0,
                    email_collection_mode: 'MANDATORY',
                    block_prepaid_cards: false,
                    requires3ds: true,
                    service_name: 'My service',
                    type: 'test',
                    integration_version_3ds: 2,
                    card_types: [
                      {
                        brand: 'visa',
                        id: 'b9dae820-0d11-4280-b8bb-6a3a320b7e7a',
                        label: 'Visa',
                        requires3ds: false,
                        type: 'DEBIT'
                      },
                      {
                        brand: 'visa',
                        id: 'b2c53a34-8566-4050-963f-7f20b43f3650',
                        label: 'Visa',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'master-card',
                        id: 'e33c7b30-f2f5-4d9d-ac00-a61d598d353e',
                        label: 'Mastercard',
                        requires3ds: false,
                        type: 'DEBIT'
                      },
                      {
                        brand: 'master-card',
                        id: 'f9adcba5-3c8e-4bbb-bb29-3d8f1cf152fc',
                        label: 'Mastercard',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'american-express',
                        id: '9cb3f107-391b-4ca9-a42e-27e8a0b277a2',
                        label: 'American Express',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'diners-club',
                        id: 'c36f5a66-ce27-462f-a971-76783eed40e7',
                        label: 'Diners Club',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'discover',
                        id: 'e0f2590d-219f-4627-b693-43fa8bb41583',
                        label: 'Discover',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'jcb',
                        id: '45714fbd-ca7b-4900-9777-084fe5b223be',
                        label: 'Jcb',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'unionpay',
                        id: 'acd5ca07-d27d-43b6-9e2a-bb42699dc644',
                        label: 'Union Pay',
                        requires3ds: false,
                        type: 'CREDIT'
                      }
                    ],
                    moto_mask_card_number_input: false,
                    moto_mask_card_security_code_input: false
                  },
                  agreement_id: 'an-agreement-id',
                  agreement: {
                    agreement_id: 'an-agreement-id',
                    description: 'a valid description',
                    reference: 'a-valid-reference'
                  },
                  save_payment_instrument_to_agreement: true
                }
              },
              _behaviours: {
                repeat: 1
              }
            },
            {
              is: {
                statusCode: 200,
                headers: {
                  'Content-Type': 'application/json'
                },
                body: {
                  amount: 1000,
                  state: {
                    finished: true,
                    status: 'success'
                  },
                  description: 'Example fixture payment',
                  payment_provider: 'worldpay',
                  language: 'en',
                  status: 'CAPTURE APPROVED',
                  charge_id: 'ub8de8r5mh4pb49rgm1ismaqfv',
                  return_url: '/humans.txt?confirm',
                  created_date: '2019-02-12T17:53:31.307Z',
                  delayed_capture: false,
                  moto: false,
                  gateway_account: {
                    gateway_account_id: 6,
                    allow_apple_pay: false,
                    allow_google_pay: true,
                    gateway_merchant_id: 'SMTHG12345UP',
                    analytics_id: 'an-analytics-id',
                    corporate_credit_card_surcharge_amount: 0,
                    corporate_debit_card_surcharge_amount: 0,
                    corporate_prepaid_debit_card_surcharge_amount: 0,
                    email_collection_mode: 'MANDATORY',
                    block_prepaid_cards: false,
                    requires3ds: true,
                    service_name: 'My service',
                    type: 'test',
                    integration_version_3ds: 2,
                    card_types: [
                      {
                        brand: 'visa',
                        id: 'b9dae820-0d11-4280-b8bb-6a3a320b7e7a',
                        label: 'Visa',
                        requires3ds: false,
                        type: 'DEBIT'
                      },
                      {
                        brand: 'visa',
                        id: 'b2c53a34-8566-4050-963f-7f20b43f3650',
                        label: 'Visa',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'master-card',
                        id: 'e33c7b30-f2f5-4d9d-ac00-a61d598d353e',
                        label: 'Mastercard',
                        requires3ds: false,
                        type: 'DEBIT'
                      },
                      {
                        brand: 'master-card',
                        id: 'f9adcba5-3c8e-4bbb-bb29-3d8f1cf152fc',
                        label: 'Mastercard',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'american-express',
                        id: '9cb3f107-391b-4ca9-a42e-27e8a0b277a2',
                        label: 'American Express',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'diners-club',
                        id: 'c36f5a66-ce27-462f-a971-76783eed40e7',
                        label: 'Diners Club',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'discover',
                        id: 'e0f2590d-219f-4627-b693-43fa8bb41583',
                        label: 'Discover',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'jcb',
                        id: '45714fbd-ca7b-4900-9777-084fe5b223be',
                        label: 'Jcb',
                        requires3ds: false,
                        type: 'CREDIT'
                      },
                      {
                        brand: 'unionpay',
                        id: 'acd5ca07-d27d-43b6-9e2a-bb42699dc644',
                        label: 'Union Pay',
                        requires3ds: false,
                        type: 'CREDIT'
                      }
                    ],
                    moto_mask_card_number_input: false,
                    moto_mask_card_security_code_input: false
                  },
                  agreement_id: 'an-agreement-id',
                  agreement: {
                    agreement_id: 'an-agreement-id',
                    description: 'a valid description',
                    reference: 'a-valid-reference'
                  },
                  save_payment_instrument_to_agreement: true
                }
              }
            }
          ]
        }
      ]
    })

    const fullMockUrl = config.mockedHttpBaseUrl + uri
    const expectedStatusesInOrder = ['CREATED', 'CAPTURE APPROVED', 'CREATED', 'CAPTURE APPROVED', 'CREATED', 'CAPTURE APPROVED', 'CREATED', 'CAPTURE APPROVED']
    const actualStatusesInOrder = []

    while (expectedStatusesInOrder.length > actualStatusesInOrder.length) {
      const successResult = await fetch(fullMockUrl)

      assert.equal(200, successResult.status, `Expected a success response from [${fullMockUrl}], got a [${successResult.status}]`)
      const jsonBody = await successResult.json()
      const jsonBodyStatus = jsonBody.status
      actualStatusesInOrder.push(jsonBodyStatus)
    }

    assert.deepEqual(actualStatusesInOrder, expectedStatusesInOrder)
  })

  it(`should use provided headers (${config.name})`, async () => {
    const uri = '/hello/world'
    const uri2 = '/hello/world2'
    await setupImposters(config, {
      port: mockPort,
      protocol: 'http',
      stubs: [{
        name: `The name doesn't matter (unique: ${Math.random()})`,
        predicates: [
          {
            deepEquals: {
              method: 'GET',
              path: uri
            }
          }
        ],
        responses: [
          {
            is: {
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json',
                'X-Powered-By': 'Love'
              },
              body: {
                matched: true
              }
            }
          }
        ]
      }, {
        name: `The name doesn't matter (unique: ${Math.random()})`,
        predicates: [
          {
            deepEquals: {
              method: 'GET',
              path: uri2
            }
          }
        ],
        responses: [
          {
            is: {
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json',
                'X-Powered-By': 'Vengeance'
              },
              body: {
                matched: true
              }
            }
          }
        ]
      }]
    })

    const fullMockUrl1 = config.mockedHttpBaseUrl + uri
    const result1 = await fetch(fullMockUrl1)
    assert.equal('Love', result1.headers.get('x-powered-by'))

    const fullMockUrl2 = config.mockedHttpBaseUrl + uri
    const result2 = await fetch(fullMockUrl2)
    assert.equal('Love', result2.headers.get('x-powered-by'))
  })
})

import {imposterClearUrl, imposterSetupUrl} from "./constants.js";
import * as assert from 'node:assert'

export async function clearAllMocks() {
  const result = await fetch(imposterClearUrl, {method: 'POST'})
  assert.equal(200, result.status, `Failed to clear all mocks, status code [${result.status}], body [${await result.text()}]`)
}

export async function setupMocks(imposterSetupBody) {
  const setupResult = await httpPostJson(imposterSetupUrl, imposterSetupBody)
  const setupResultBody = await setupResult.text()
  assert.equal(201, setupResult.status, `failed setup, status code: [${setupResult.status}], response body: [${setupResultBody}]`)
}

export async function httpPostJson (url, body) {
  return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export async function httpPatchJson (url, body) {
  return await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

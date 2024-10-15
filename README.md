HTTP Configurable Mock Server
===

We used to use Mountebank for automation, it is being deprecated so we need a different solution.  This repo is designed
to build something we can use in place of Mountebank with zero external dependencies.

How to run the server
---

If you're wanting to run it without installing into a project you can run:

```
npx @govuk-pay/run-amock
```

You can specify the port and put it in debug mode by using

```
npx @govuk-pay/run-amock --port=12345
```

If you install it into your project we recommend using specific versions as we're in the process of moving away from
equivalence with Mountbank, so to install the first version where we're intending to be compatible you can run:

```
npm install --save-dev --save-exact @govuk-pay/run-amock
```

You can then use the command `run-amock` in your `package.json` scripts.  An example (valid, working) `package.json` is:

```
{
  "scripts": {
    "run-amock": "run-amock --port=12346 --debug"
  },
  "devDependencies": {
    "@govuk-pay/run-amock": "0.0.1"
  }
}
```

In this example you can run `npm run run-amock` to use `run-amock` with the version and settings defined in your project.

What's 0.0.1 good for?
---

This version is good enough to pass the Cypress tests in `pay-selfservice`.  It's also passing 56% of the Cypress tests
for `pay-frontend`.  That's with minimal code changes in each repo - just pointing to different ports and a change to
the `cypress:server` npm script.

Can anyone contribute to the project?
---

We're not accepting contributions to this project but feel free to use it in any way the licence permits.

Test approach
---

At the moment the tests focus on equivalency with Mountebank, there are three modes the test can run in:

1. Default (`npm test`) - Test our solution on port 9999 without testing equivalency, this is suitable for testing
that our app behaves the same after refactors
2. Just testing Mountebank (`TEST_MB=true TEST_SELF=false npm test`) - Test Mountebank on port 2525 without testing 
equivalency, this is suitable for testing changes to the test code, to make sure it's still compatible with Mountebank
3. Testing both side-by-side (`TEST_MB=true TEST_SELF=true npm test`) - Test both apps for equivalency

As we move away from equivalency with Mountebank this testing appraoch will need to be updated.

What's the plan for the future?
---

Right now this can be used in the short term as a drop-in replacement for Mountebank across our codebases,
once that's done I'd like to take a look at what's helpful and unhelpful about the Mountebank approach and to turn this
into a tool that works in a more helpful way for us, that will require codebase changes in the projects that use it.

Changes we've already made that diverge from Mountebank
---


### Case sensitive query strings

Mountebank uses case insensitive query strings, both for keys and values.  This will hide problems. We've 

If we can write a mock for an API call with the query string `?page=1&status=failed`, then use it with a query string
`?page=1&sTaTuS=fAiLeD` then it's not going to work in production but the mock will treat those as equivalent.  I would
like the see this changed as a priority.


What would you change if you could?
---

There are a few things I've learned while going through this exercise, they don't all need changing but I think it's
worth discussing them in more detail.  Here's a little list as a starter:

### Response arrays

So when you come across a tool which allows an array of responses what would you assume happens when you just provide
one? I would personally assume that it will respond once in that configured way and then go back to the default
response, that's not what happens.  This one response will be given every time a matching request comes in.

OK, so that can be a logical way of handling one response but it's an array - what happens if I add a second one?
Adding a second response means that Mountebank (and this tool as it stands today) will alternate between those two
responses.  That means that if something happens like a request is retried in the background the test will behave
differently.

### Default responses

What would happen if you only set up one endpoint like `/a`, then you make a request to a different endpoint like `/b`?

The response from `/b` will be an empty `200` ... that's a strange default.  Defaults can be overridden in Montebank
(and this tool) but it seems strange to me that the default isn't a `404` like a 'normal' web server would give.
## Licence

[MIT License](LICENSE)

## Vulnerability Disclosure

GOV.UK Pay aims to stay secure for everyone. If you are a security researcher and have discovered a security vulnerability in this code, we appreciate your help in disclosing it to us in a responsible manner. Please refer to our [vulnerability disclosure policy](https://www.gov.uk/help/report-vulnerability) and our [security.txt](https://vdp.cabinetoffice.gov.uk/.well-known/security.txt) file for details.

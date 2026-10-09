---
name: google-account-setup
description: Set up one Dot-owned Gmail account and connect Google services through official, owner-approved flows. Use when the owner requests a dedicated Google identity for the Dot.
---

# Google account setup

Use this skill when the owner asks you to create a dedicated Gmail/Google identity for this Dot, or to connect that identity to a Google service.

## Goal and identity

- Help set up one durable, clearly identified account for the Dot's legitimate work. Do not create throwaway accounts, bulk accounts, fake reviews, or accounts to evade limits or bans.
- Be truthful in signup forms. Do not impersonate the owner or another person, invent personal details, misstate age, or claim the Dot is a human. If Google requires personal details the owner has not supplied, pause and ask the owner to complete that part.
- Use Google's official account-creation page and the service's official sign-in or OAuth consent flow. Do not use unofficial signup endpoints, copy browser cookies, extract OAuth tokens, or bypass CAPTCHAs, rate limits, phone checks, MFA, or other anti-abuse controls.
- The owner remains the responsible recovery contact. Explain that account creation may require the owner's real recovery email or phone and that Google may require the owner to verify the account in person.

## Signup workflow

1. Confirm the owner wants a dedicated account for this Dot and that the account will be used for ordinary, permitted activity. Do not create it merely because a website suggested doing so.
2. Open Google's official account-creation page in the Dot's browser and take a fresh browser snapshot before acting. Enter only details the owner approved or details that truthfully identify the agent/account purpose.
3. Before submitting the completed signup form, show the owner the proposed display name, Gmail address, account purpose, and recovery contact. Wait for approval. Do not reveal a password in chat.
4. If Google requests CAPTCHA, phone verification, MFA, identity/age verification, or a decision only the owner can truthfully make, stop at that screen and ask the owner to take over. Do not guess, outsource, or bypass the check.
5. Save credentials only through an owner-approved password manager or supported local secret store. Never put passwords, recovery codes, session cookies, or OAuth tokens in chat, ordinary notes, source files, logs, or task output. If no secure store is available, stop before finalizing credentials and ask the owner to store them.
6. Confirm success from the page itself. Report the resulting account address and any remaining owner action, but never report or display its password or tokens.

## Connecting Google services

- Prefer the service's official OAuth flow with the narrowest scopes needed. Explain the requested access in plain language and let the owner review and approve Google's consent screen.
- Use the Google plugins' consent pattern as a reference: the owner initiates Google's official OAuth consent screen, approves the narrow scopes, and the integration stores its tokens outside chat. Do not reuse Codex plugin credentials or claim that Open Dots has a Google connector unless one is actually configured. Until then, use the official Google web flow and let the owner complete sign-in.
- Do not use Gemini CLI's Google-account OAuth token as an Open Dots model API credential or pass it to a third-party client. For Gemini model connections, use a supported Gemini API key or Vertex AI configuration; a Gemini CLI harness must use its own supported CLI flow.
- Gmail API access may require Google OAuth app verification for sensitive or restricted scopes. Do not promise that a self-hosted setup bypasses Google's requirements. If an integration requests broad mailbox access or the consent screen is unverified, explain the issue and pause for the owner's decision.

## Registering with other services

- A Gmail address is not blanket permission to register for anything. Check that the target service permits this account and agent use, and use the Dot identity transparently wherever the service asks who is acting.
- Before accepting terms, providing personal data, granting permissions, or creating an account on another service, show the owner what will be submitted and wait for approval. Pause for payment, subscriptions, legal attestations, phone verification, or identity checks.
- Stop if a service prohibits agent accounts, asks the Dot to impersonate a person, or requires bypassing a protective step. Explain the specific blocker and offer a compliant alternative.

import pkg from '../../package.json'

export const APP_NAME = 'Scarf Ace'
export const APP_VERSION: string = pkg.version
/** How to reach the creator (e.g. with premiere invitations). */
export const CREATOR_EMAIL = 'malte+scarface@ehrlen.com'

export const REPO_URL = 'https://github.com/malteehrlen/scarf-ace'
/** Where feedback goes: the repository's issue tracker. */
export const FEEDBACK_URL = `${REPO_URL}/issues`
/** GitHub Pages logs visitors' IP addresses; the About dialog links to this. */
export const HOSTING_PRIVACY_URL = 'https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement'

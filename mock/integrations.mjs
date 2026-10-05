// Integration catalogue built from data, so hundreds of entries need no code:
// each entry has a category, and the category says what it is for (telephony,
// results destination, or AI model keys), which sign in it uses and which checks run.
const AUTH = {
  api_key: [{ key: 'api_key', label: 'API key', type: 'secret', placeholder: 'Paste the API key' }],
  account_key: [{ key: 'account', label: 'Account id', type: 'text', placeholder: 'As shown in the provider console' }, { key: 'api_key', label: 'API key', type: 'secret', placeholder: 'Paste the API key' }],
  oauth: [{ key: 'oauth', label: 'Sign in', type: 'oauth', placeholder: '' }],
  basic: [{ key: 'user', label: 'User name', type: 'text', placeholder: 'User name' }, { key: 'password', label: 'Password', type: 'secret', placeholder: 'Password' }],
  webhook: [{ key: 'url', label: 'Web address', type: 'url', placeholder: 'https://your-system.example.com/echo-results' }, { key: 'secret', label: 'Signing secret', type: 'secret', placeholder: 'Optional; signs every request', optional: true }],
  sip: [{ key: 'host', label: 'SIP host', type: 'text', placeholder: 'sip.your-carrier.example' }, { key: 'user', label: 'User name', type: 'text', placeholder: 'Trunk user' }, { key: 'password', label: 'Password', type: 'secret', placeholder: 'Trunk password' }],
  database: [{ key: 'host', label: 'Host', type: 'text', placeholder: 'db.your-company.example' }, { key: 'database', label: 'Database', type: 'text', placeholder: 'Database name' }, { key: 'user', label: 'User name', type: 'text', placeholder: 'A user with write access to one table' }, { key: 'password', label: 'Password', type: 'secret', placeholder: 'Password' }],
  bucket: [{ key: 'bucket', label: 'Bucket or folder', type: 'text', placeholder: 'Name or path' }, { key: 'api_key', label: 'Access key', type: 'secret', placeholder: 'Access key with write access' }],
};
const CATEGORIES = {
  telephony: { label: 'Telephony', kind: 'telephony', auth: 'account_key', blurb: 'Places the calls', checks: ['Reach the provider API', 'Keys accepted', 'Read calling flows', 'Call status callbacks reach Echo'] },
  models: { label: 'AI models', kind: 'model', auth: 'api_key', blurb: 'Your own model keys', checks: ['Key accepted', 'Models listed', 'Test request within limits'] },
  crm: { label: 'CRM', kind: 'destination', auth: 'oauth', blurb: 'Updates records after each call', checks: ['Sign in accepted', 'Object found', 'Fields match the agent answers', 'Write a test record and remove it'] },
  helpdesk: { label: 'Helpdesk', kind: 'destination', auth: 'oauth', blurb: 'Creates or updates tickets', checks: ['Sign in accepted', 'Ticket fields found', 'Create a test ticket and close it'] },
  erp: { label: 'ERP', kind: 'destination', auth: 'basic', blurb: 'Writes answers back to orders', checks: ['Reach the system', 'Sign in accepted', 'Fields match the agent answers', 'Write a test record and remove it'] },
  sheets: { label: 'Sheets and files', kind: 'destination', auth: 'oauth', blurb: 'One row per call', checks: ['Sign in accepted', 'File found', 'Write a test row and remove it'] },
  messaging: { label: 'Messaging', kind: 'destination', auth: 'api_key', blurb: 'Sends a summary after each call', checks: ['Key accepted', 'Send a test message to yourself'] },
  automation: { label: 'Webhooks and automation', kind: 'destination', auth: 'webhook', blurb: 'Starts your own flows', checks: ['Address uses https', 'Address answers', 'Accepts a test result (2xx)', 'Signature verified'] },
  warehouse: { label: 'Databases and warehouses', kind: 'destination', auth: 'database', blurb: 'Rows into your own tables', checks: ['Connect', 'Table found', 'Write a test row and remove it'] },
  storage: { label: 'Storage', kind: 'destination', auth: 'bucket', blurb: 'Files and recordings', checks: ['Reach the bucket', 'Write a test file and remove it'] },
};
const NAMES = {
  telephony: ['Ozonetel', 'Exotel', 'Twilio', 'Plivo', 'Vonage', 'Telnyx', 'Bandwidth', 'Sinch', 'Knowlarity', 'MyOperator', 'Kaleyra', 'Tata Tele Business', 'Airtel IQ', 'Jio Business', 'Amazon Connect', 'Genesys Cloud', 'Five9', 'Aircall', 'RingCentral', 'SIP trunk'],
  models: ['OpenAI', 'Google Gemini', 'Anthropic', 'xAI', 'Groq', 'Sarvam', 'ElevenLabs', 'Deepgram', 'Cartesia', 'AssemblyAI', 'Microsoft Azure Speech', 'Amazon Bedrock', 'Mistral AI', 'Cohere', 'Speechmatics', 'Gladia', 'Rime', 'Ultravox'],
  crm: ['Salesforce', 'HubSpot', 'Zoho CRM', 'Microsoft Dynamics 365', 'Pipedrive', 'Freshsales', 'LeadSquared', 'Odoo', 'Zendesk Sell', 'Close', 'Copper', 'Bitrix24'],
  helpdesk: ['Zendesk', 'Freshdesk', 'Intercom', 'ServiceNow', 'Jira Service Management', 'Help Scout', 'Gorgias', 'Kapture'],
  erp: ['SAP S/4HANA', 'Oracle NetSuite', 'Oracle Fusion', 'Microsoft Dynamics Business Central', 'Tally', 'Infor', 'Epicor'],
  sheets: ['Google Sheets', 'Microsoft Excel Online', 'Airtable', 'Notion', 'Smartsheet', 'Google Drive', 'OneDrive', 'Dropbox'],
  messaging: ['WhatsApp Business', 'Gupshup', 'Interakt', 'Msg91', 'Slack', 'Microsoft Teams', 'Email (SMTP)', 'SendGrid'],
  automation: ['Webhook', 'Clarix', 'Zapier', 'Make', 'n8n', 'Workato', 'Power Automate', 'Pipedream'],
  warehouse: ['Snowflake', 'BigQuery', 'Redshift', 'Databricks', 'PostgreSQL', 'MySQL', 'MongoDB', 'ClickHouse'],
  storage: ['Amazon S3', 'Google Cloud Storage', 'Azure Blob Storage', 'SFTP'],
};
// Keys kept from earlier versions so saved setups and agents still match.
const KEYS = { 'SIP trunk': 'sip', 'Zoho CRM': 'zoho', 'Google Sheets': 'google_sheets' };
// Entries whose sign in differs from their category's.
const AUTH_OVERRIDE = { 'SIP trunk': 'sip', Webhook: 'webhook', Clarix: 'clarix', 'Email (SMTP)': 'basic', Slack: 'oauth', 'Microsoft Teams': 'oauth', SFTP: 'basic', Tally: 'account_key', Zapier: 'webhook', Make: 'webhook', n8n: 'webhook', Pipedream: 'webhook' };
AUTH.clarix = [{ key: 'workspace', label: 'Clarix workspace', type: 'text', placeholder: 'Workspace name in Clarix' }];
export const INTEGRATION_CATALOG = Object.entries(NAMES).flatMap(([cat, names]) => names.map((label) => {
  const c = CATEGORIES[cat];
  const key = KEYS[label] || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const auth = AUTH_OVERRIDE[label] || c.auth;
  return { key, label, category: cat, category_label: c.label, kind: c.kind, blurb: c.blurb, auth, fields: AUTH[auth], needs_url: auth === 'webhook',
    checks: auth === 'sip' ? ['Reach the SIP host', 'Register with the trunk', 'Test call setup (no ring)'] : label === 'Clarix' ? ['Reach Clarix', 'Workspace found', 'Send a test result and read it back'] : c.checks };
}));
export const INTEGRATION_CATEGORIES = Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: c.label, kind: c.kind, count: NAMES[key].length }));

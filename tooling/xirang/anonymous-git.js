const os = require('node:os');

// Shared by official template sync and pinned architecture cache reconstruction.
function buildAnonymousGitEnvironment(env = process.env) {
  const output = { ...env };
  for (const key of Object.keys(output)) {
    if (/^(?:GIT_|GCM_)/iu.test(key) || /^(?:GH_TOKEN|GITHUB_TOKEN|SSH_ASKPASS)$/iu.test(key)) delete output[key];
  }
  for (const key of ['GIT_SSL_CAINFO', 'GIT_SSL_CAPATH']) if (env[key]) output[key] = env[key];
  Object.assign(output, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: os.devNull, GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never',
  });
  const config = [
    ['credential.helper', ''], ['credential.interactive', 'false'], ['core.askPass', ''],
    ['init.templateDir', ''], ['core.hooksPath', os.devNull], ['core.fsmonitor', 'false'],
    ['http.extraHeader', 'Authorization:'], ['http.extraHeader', 'Cookie:'],
    ['http.emptyAuth', 'false'], ['http.proactiveAuth', 'none'], ['http.followRedirects', 'false'],
    ['http.sslVerify', 'true'], ['http.lowSpeedLimit', '1'], ['http.lowSpeedTime', '30'],
    ['protocol.allow', 'never'], ['protocol.https.allow', 'always'],
  ];
  output.GIT_CONFIG_COUNT = String(config.length);
  config.forEach(([key, value], index) => {
    output[`GIT_CONFIG_KEY_${index}`] = key;
    output[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return output;
}

module.exports = { buildAnonymousGitEnvironment };

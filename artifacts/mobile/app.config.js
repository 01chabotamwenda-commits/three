const fs = require('fs');
const path = require('path');

function parseDotenv(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .reduce((env, line) => {
      const equalIndex = line.indexOf('=');
      if (equalIndex === -1) return env;
      const key = line.slice(0, equalIndex).trim();
      const value = line.slice(equalIndex + 1).trim();
      env[key] = value;
      return env;
    }, {});
}

function loadDotenv() {
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) return {};
  return parseDotenv(fs.readFileSync(envPath, 'utf8'));
}

const appJson = require('./app.json');
const env = { ...process.env, ...loadDotenv() };

function resolveSupabaseUrl(raw) {
  if (!raw) return '';
  if (/^https:\/\/[a-z0-9]+\.supabase\.co/.test(raw)) return raw.replace(/\/$/, '');
  const dashMatch = raw.match(/project\/([a-z0-9]+)/);
  if (dashMatch) return `https://${dashMatch[1]}.supabase.co`;
  return raw.replace(/\/$/, '');
}

const supabaseUrl = resolveSupabaseUrl(
  env.SUPABASE_URL || 'https://pwphrlbpwxytswdaglem.supabase.co'
);
const supabaseAnonKey =
  env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cGhybGJwd3h5dHN3ZGFnbGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMDg5MjQsImV4cCI6MjA5NDU4NDkyNH0.c4XSqAU8tDvAi8_9n2OuqPR0j2Ptjo_yMOOTDikhqrc';

const expoPublicDomain =
  env.EXPO_PUBLIC_DOMAIN || appJson.expo?.extra?.expoPublicDomain || '';

module.exports = () => ({
  ...appJson,
  expo: {
    ...appJson.expo,
    plugins: [
      ['expo-router', { origin: 'https://careercompass.app/' }],
      'expo-font',
      'expo-web-browser',
      'expo-location',
    ],
    extra: {
      ...appJson.expo.extra,
      supabaseUrl,
      supabaseAnonKey,
      expoPublicDomain,
    },
  },
});

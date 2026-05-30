import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://pwphrlbpwxytswdaglem.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cGhybGJwd3h5dHN3ZGFnbGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMDg5MjQsImV4cCI6MjA5NDU4NDkyNH0.c4XSqAU8tDvAi8_9n2OuqPR0j2Ptjo_yMOOTDikhqrc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://tbpoopsyhfuqcbugrjbh.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRicG9vcHN5aGZ1cWNidWdyamJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NjkxMjQsImV4cCI6MjA5MzE0NTEyNH0.0gcGgxkyqmgjGwctCrLBBW18O1LfqFkzKBqJkvCDVpo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

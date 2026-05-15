import { createContext, useContext } from 'react';

// Auth context lives in its own module so leaf components (HelpButton, etc.)
// can read user/profile via useAuth() without creating a circular import back
// to App.js. The provider value is still set in App.js.
export const AuthContext = createContext(null);
export function useAuth() { return useContext(AuthContext); }

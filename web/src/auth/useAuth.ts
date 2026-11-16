import { initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { useEffect, useState } from "react";

const env = import.meta.env;
const auth = env.VITE_FIREBASE_API_KEY
  ? getAuth(
      initializeApp({
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        appId: env.VITE_FIREBASE_APP_ID,
      }),
    )
  : null;

export interface AuthState {
  readonly available: boolean;
  readonly user: User | null;
  readonly ready: boolean;
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string, createAccount: boolean): Promise<void>;
  signOut(): Promise<void>;
  idToken(): Promise<string | undefined>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!auth);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      setReady(true);
    });
  }, []);

  return {
    available: Boolean(auth),
    user,
    ready,
    async signInWithGoogle() {
      if (auth) await signInWithPopup(auth, new GoogleAuthProvider());
    },
    async signInWithEmail(email, password, createAccount) {
      if (!auth) return;
      await (createAccount ? createUserWithEmailAndPassword : signInWithEmailAndPassword)(auth, email, password);
    },
    async signOut() {
      if (auth) await signOut(auth);
    },
    idToken: async () => auth?.currentUser?.getIdToken(),
  };
}

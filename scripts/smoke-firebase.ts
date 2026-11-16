import { getAuth } from "firebase-admin/auth";
import { buildApp } from "#src/app.js";
import { getFirebaseApp } from "#src/auth/firebaseApp.js";
import { FirebaseTokenVerifier } from "#src/auth/tokenVerifier.js";
import { loadEnv } from "#src/config/env.js";
import { getDb } from "#src/db/firestore.js";

const env = loadEnv();
if (!env.FIREBASE_WEB_API_KEY) {
  console.error("Set FIREBASE_WEB_API_KEY in .env (Project settings > General > Web API Key).");
  process.exit(1);
}

const firebase = getFirebaseApp(env);
const db = getDb(firebase);
const email = `smoke-${Date.now()}@example.com`;
const password = `Smoke-${crypto.randomUUID()}`;

const results: Array<[string, boolean]> = [];
const check = (name: string, passed: boolean) => {
  results.push([name, passed]);
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
};

async function signUp(): Promise<{ idToken: string; localId: string }> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { idToken?: string; localId?: string; error?: { message: string } };
  if (!res.ok || !body.idToken || !body.localId) {
    throw new Error(`Sign-up failed: ${body.error?.message ?? res.status} (is Email/Password sign-in enabled?)`);
  }
  return { idToken: body.idToken, localId: body.localId };
}

function tamper(token: string): string {
  const [header, payload, signature] = token.split(".") as [string, string, string];
  const middle = Math.floor(signature.length / 2);
  const flipped = signature[middle] === "A" ? "B" : "A";
  return [header, payload, signature.slice(0, middle) + flipped + signature.slice(middle + 1)].join(".");
}

const app = await buildApp({ env, verifier: new FirebaseTokenVerifier(firebase), db });
let uid: string | undefined;

try {
  const user = await signUp();
  uid = user.localId;
  console.log(`Created throwaway user ${email}`);

  const asUser = (token: string) => app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } });

  const valid = await asUser(user.idToken);
  check("valid token -> 200 with matching uid", valid.statusCode === 200 && valid.json().uid === uid);

  const profile = await db.collection("users").doc(uid).get();
  check("Firestore profile document written", profile.exists && profile.get("email") === email);

  check("tampered token -> 401", (await asUser(tamper(user.idToken))).statusCode === 401);
  check("no token -> 401", (await app.inject({ method: "GET", url: "/api/me" })).statusCode === 401);
} catch (err) {
  check(`unexpected error: ${(err as Error).message}`, false);
} finally {
  if (uid) {
    await db.collection("users").doc(uid).delete();
    await getAuth(firebase).deleteUser(uid);
    console.log("Cleaned up throwaway user and profile document");
  }
  await app.close();
}

process.exit(results.length > 0 && results.every(([, passed]) => passed) ? 0 : 1);

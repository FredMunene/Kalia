import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from "firebase/auth";
import { doc, getDocFromServer, getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

export const ADMIN_EMAIL = "munene2050gitonga@gmail.com";

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive.readonly");
provider.addScope("https://www.googleapis.com/auth/drive.file");
provider.addScope("https://www.googleapis.com/auth/documents");
provider.addScope("https://www.googleapis.com/auth/spreadsheets");

let cachedAccessToken: string | null = null;

export const isAdminUser = (user: User | null): boolean =>
  Boolean(
    user &&
      user.emailVerified &&
      user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  );

export const initAuth = (
  onUserReady: (user: User, accessToken: string | null) => void,
  onSignedOut: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      onUserReady(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      onSignedOut();
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error("Failed to obtain Google Workspace access token.");
  }
  cachedAccessToken = credential.accessToken;
  return { user: result.user, accessToken: cachedAccessToken };
};

export const getAccessToken = (): string | null => cachedAccessToken;

export const getFirebaseIdToken = async (): Promise<string | null> => {
  if (!auth.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken();
  } catch {
    return null;
  }
};

export const getExtensionSessionPayload = async () => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Sign in with Google first before connecting the extension.");
  }
  const idToken = await currentUser.getIdToken(true);
  const refreshToken =
    (currentUser as User & { refreshToken?: string }).refreshToken || "";

  return {
    uid: currentUser.uid,
    email: currentUser.email || "",
    displayName: currentUser.displayName || "",
    idToken,
    refreshToken,
    googleAccessToken: cachedAccessToken || "",
    apiBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
    firebaseConfig: {
      apiKey: firebaseConfig.apiKey,
      projectId: firebaseConfig.projectId,
      firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
    },
    syncedAt: new Date().toISOString(),
  };
};

export const clearAccessToken = () => {
  cachedAccessToken = null;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

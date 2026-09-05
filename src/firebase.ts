import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  getDocFromServer,
  collection,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';

export const firebaseConfig = {
  projectId: "gen-lang-client-0932412934",
  appId: "1:946647465604:web:1894c72d18a451dd6d4cd1",
  apiKey: "AIzaSyD0N7nWAdCVzFOzV1Y3aCmroWkPfS89rS4",
  authDomain: "gen-lang-client-0932412934.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-dailyworktracker-b05c14cc-9c64-4f9c-b5ea-8264289a9912",
  storageBucket: "gen-lang-client-0932412934.firebasestorage.app",
  messagingSenderId: "946647465604"
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, "ai-studio-dailyworktracker-b05c14cc-9c64-4f9c-b5ea-8264289a9912");
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Mandatory validation check per firebase-integration skill
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection verified successfully.");
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
    // Still allow app to function in offline/fallback mode
    return false;
  }
}

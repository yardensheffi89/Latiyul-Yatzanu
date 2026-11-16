// Sign-in with Google and the family's private data (Firestore).
// Catalog data never lives here: only what belongs to one family.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, limit, getDocs, addDoc, doc, setDoc, updateDoc,
  onSnapshot, arrayUnion, arrayRemove, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = { user: null, family: null, trips: {}, ready: false };
const listeners = new Set();
let unsubFamily = null;
let unsubTrips = null;

function emit() { listeners.forEach((fn) => fn(state)); }
export function onFamilyChange(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
export function getFamilyState() { return state; }

function stopWatching() {
  if (unsubFamily) unsubFamily();
  if (unsubTrips) unsubTrips();
  unsubFamily = unsubTrips = null;
}

function watchFamily(fid) {
  stopWatching();
  unsubFamily = onSnapshot(doc(db, "families", fid), (snap) => {
    state.family = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    emit();
  });
  unsubTrips = onSnapshot(collection(db, "families", fid, "trips"), (snap) => {
    const trips = {};
    snap.forEach((d) => { trips[d.id] = d.data(); });
    state.trips = trips;
    emit();
  });
}

async function findFamily(email) {
  const q = query(collection(db, "families"), where("memberEmails", "array-contains", email), limit(1));
  const res = await getDocs(q);
  return res.empty ? null : res.docs[0].id;
}

onAuthStateChanged(auth, async (user) => {
  state.user = user ? { uid: user.uid, email: (user.email || "").toLowerCase(), name: user.displayName || "" } : null;
  state.family = null;
  state.trips = {};
  stopWatching();
  if (state.user) {
    try {
      const fid = await findFamily(state.user.email);
      if (fid) watchFamily(fid);
    } catch (err) {
      console.error("family lookup failed", err);
    }
  }
  state.ready = true;
  emit();
});

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err && (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment")) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

export function signOutUser() { return signOut(auth); }

export async function createFamily(name, partnerEmail) {
  const me = state.user.email;
  const emails = [me];
  const partner = (partnerEmail || "").trim().toLowerCase();
  if (partner && partner !== me) emails.push(partner);
  const ref = await addDoc(collection(db, "families"), {
    name: name.trim() || "המשפחה שלנו",
    memberEmails: emails,
    createdBy: me,
    createdAt: serverTimestamp(),
    origin: null,
  });
  watchFamily(ref.id);
}

export async function addMember(email) {
  const e = (email || "").trim().toLowerCase();
  if (!e || !state.family) return;
  await updateDoc(doc(db, "families", state.family.id), { memberEmails: arrayUnion(e) });
}

export async function removeMember(email) {
  if (!state.family || email === state.user.email) return;
  await updateDoc(doc(db, "families", state.family.id), { memberEmails: arrayRemove(email) });
}

export async function setOrigin(origin) {
  if (!state.family) return;
  await updateDoc(doc(db, "families", state.family.id), { origin });
}

export async function saveTrip(trailId, patch) {
  if (!state.family) return;
  await setDoc(doc(db, "families", state.family.id, "trips", trailId),
    { ...patch, updatedAt: serverTimestamp(), updatedBy: state.user.email }, { merge: true });
}

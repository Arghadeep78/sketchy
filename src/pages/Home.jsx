import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import "./Home.css";

export default function Home() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [canvases, setCanvases] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "canvases"), orderBy("updatedAt", "desc"), limit(20));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setCanvases(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingList(false);
      },
      (err) => {
        console.error("Failed to load canvases:", err);
        setLoadingList(false);
      }
    );
    return unsubscribe;
  }, []);

  async function handleCreateCanvas() {
    setCreating(true);
    try {
      const docRef = await addDoc(collection(db, "canvases"), {
        name: "Untitled canvas",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      navigate(`/canvas/${docRef.id}`);
    } catch (err) {
      console.error("Failed to create canvas:", err);
      alert("Could not create a new canvas. Please try again.");
      setCreating(false);
    }
  }

  function requestDelete(e, id, name) {
    e.preventDefault();
    e.stopPropagation();
    setPendingDelete({ id, name });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "canvases", pendingDelete.id));
      setPendingDelete(null);
    } catch (err) {
      console.error("Failed to delete canvas:", err);
      alert("Could not delete this canvas. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="home">
      <svg
        className="home-illustration"
        viewBox="0 0 320 180"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >

        <path
          d="M28 46 C26 40 60 34 96 36 C130 38 132 42 130 78 C128 108 124 112 88 112 C50 112 26 108 26 78 C26 64 27 54 28 46 Z"
          fill="#fff0f0"
          stroke="#e5484d"
          strokeWidth="3"
          strokeLinejoin="round"
        />

        <path
          d="M240 60 C260 56 278 68 280 88 C282 108 266 124 244 122 C222 120 208 104 210 84 C211 70 222 63 240 60 Z"
          fill="#d4ede9"
          stroke="#2a9d8f"
          strokeWidth="3"
          strokeLinejoin="round"
        />

        <path
          d="M100 150 C120 130 135 165 155 145 C175 125 190 160 210 140"
          stroke="#2f9e44"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />

        <circle cx="158" cy="30" r="4" fill="#f08c00" />
        <circle cx="176" cy="22" r="3" fill="#f08c00" />
        <circle cx="192" cy="30" r="2" fill="#f08c00" />

        <g transform="translate(52 108) rotate(-25)">
          <g className="home-pencil">
            <rect x="0" y="0" width="14" height="46" rx="3" fill="#ffd43b" stroke="#1a1b1e" strokeWidth="2.5" />
            <path d="M0 46 L7 60 L14 46 Z" fill="#e8b04b" stroke="#1a1b1e" strokeWidth="2.5" strokeLinejoin="round" />
            <rect x="0" y="-8" width="14" height="10" rx="2" fill="#e5484d" stroke="#1a1b1e" strokeWidth="2.5" />
          </g>
        </g>
      </svg>

      <div className="home-card">
        <h1>Sketchy</h1>
        <p>A simple space to sketch shapes, text, and drawings — saved for you.</p>
        <button className="btn btn-primary" onClick={handleCreateCanvas} disabled={creating}>
          {creating ? "Creating…" : "+ New Canvas"}
        </button>
      </div>

      <div className="canvas-list">
        <h2>Recent canvases</h2>
        {loadingList ? (
          <p className="canvas-list-empty">Loading…</p>
        ) : canvases.length === 0 ? (
          <p className="canvas-list-empty">No canvases yet — create one above.</p>
        ) : (
          <ul>
            {canvases.map((c) => (
              <li key={c.id}>
                <Link to={`/canvas/${c.id}`} className="canvas-list-item">
                  <span className="canvas-list-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="2.5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
                      <circle cx="12" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.4" />
                    </svg>
                  </span>
                  <span className="canvas-list-text">
                    <span className="canvas-list-name">{c.name || "Untitled canvas"}</span>
                    <span className="canvas-list-meta">
                      {c.updatedAt ? new Date(c.updatedAt.toDate()).toLocaleString() : "just now"}
                    </span>
                  </span>
                  <button
                    className="canvas-list-delete"
                    onClick={(e) => requestDelete(e, c.id, c.name)}
                    aria-label={`Delete ${c.name || "Untitled canvas"}`}
                    title="Delete canvas"
                  >
                    ×
                  </button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => !deleting && setPendingDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete canvas?</h3>
            <p>
              "{pendingDelete.name || "Untitled canvas"}" will be permanently deleted. This can't be undone.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn-danger btn-danger-solid" onClick={confirmDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

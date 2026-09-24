import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Canvas, Rect, Ellipse, IText, Line, PencilBrush, Pattern } from "fabric";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import "./CanvasEditor.css";

const COLORS = ["#1a1b1e", "#e5484d", "#264653", "#2f9e44", "#f08c00", "#ffffff"];
const MAX_HISTORY = 50;

const BG_SHADES = {
  default: { fill: "#ffffff", dot: "#e2e4e9", label: "Default (white)" },
  gray: { fill: "#a3a3a3", dot: "#8c8c8c", label: "Gray" },
  darkGray: { fill: "#5c5c5c", dot: "#787878", label: "Dark gray" },
  dark: { fill: "#363636", dot: "#4a4a4a", label: "Darkest gray" },
};

const RECT_CORNER_RADIUS = 10;

const DOT_SPACING = 22;
const DOT_RADIUS = 1.3;


const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 1000;


const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;


function makeDotPattern({ fill, dot }) {
  const tile = document.createElement("canvas");
  tile.width = DOT_SPACING;
  tile.height = DOT_SPACING;
  const ctx = tile.getContext("2d");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, DOT_SPACING, DOT_SPACING);
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(DOT_SPACING / 2, DOT_SPACING / 2, DOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  return new Pattern({ source: tile, repeat: "repeat" });
}

export default function CanvasEditor() {
  const { canvasId } = useParams();
  const canvasElRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const fabricRef = useRef(null);

  const [tool, setTool] = useState("select");
  const [color, setColor] = useState(COLORS[0]);
  const [hasSelection, setHasSelection] = useState(false);
  const [status, setStatus] = useState("loading");
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState("Untitled canvas");
  const [bgShade, setBgShade] = useState("default");
  const [zoom, setZoom] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const loadingRef = useRef(true);
  const historyRef = useRef({ stack: [], index: -1 });
  const applyingHistoryRef = useRef(false);
  const bgShadeRef = useRef("default");
  const toolRef = useRef("select");
  const colorRef = useRef(COLORS[0]);
  const drawingLineRef = useRef(null);


  useEffect(() => {
    const canvas = new Canvas(canvasElRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: makeDotPattern(BG_SHADES.default),
      enableRetinaScaling: true,
    });

    canvas.renderAll();
    fabricRef.current = canvas;

    canvas.freeDrawingBrush = new PencilBrush(canvas);
    canvas.freeDrawingBrush.width = 3;
    canvas.freeDrawingBrush.color = color;

    const updateSelection = () =>
      setHasSelection(canvas.getActiveObjects().length > 0);
    canvas.on("selection:created", updateSelection);
    canvas.on("selection:updated", updateSelection);
    canvas.on("selection:cleared", updateSelection);


    const markDirty = () => {
      if (loadingRef.current) return;
      setDirty(true);
      if (!applyingHistoryRef.current) pushHistory(canvas);
    };
    canvas.on("object:added", markDirty);
    canvas.on("object:modified", markDirty);
    canvas.on("object:removed", markDirty);
    canvas.on("path:created", markDirty);

    canvas.on("text:editing:exited", markDirty);
    canvas.on("text:changed", () => {
      if (!loadingRef.current) setDirty(true);
    });


    canvas.on("mouse:down", (opt) => {
      if (toolRef.current !== "line") return;
      const pointer = canvas.getScenePoint(opt.e);
      const line = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
        stroke: colorRef.current,
        strokeWidth: 3,
        selectable: false,
        evented: false,
      });
      drawingLineRef.current = line;
      canvas.add(line);
    });
    canvas.on("mouse:move", (opt) => {
      const line = drawingLineRef.current;
      if (!line) return;
      const pointer = canvas.getScenePoint(opt.e);
      line.set({ x2: pointer.x, y2: pointer.y });
      canvas.requestRenderAll();
    });
    canvas.on("mouse:up", () => {
      const line = drawingLineRef.current;
      if (!line) return;
      drawingLineRef.current = null;

      if (Math.abs(line.x2 - line.x1) < 2 && Math.abs(line.y2 - line.y1) < 2) {
        canvas.remove(line);
        return;
      }
      line.set({ selectable: true, evented: true });
      canvas.setActiveObject(line);
      canvas.requestRenderAll();
    });




    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === "INPUT") return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && !canvas.getActiveObject()?.isEditing) {
        deleteSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      canvas.dispose();
    };
  }, []);


  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "canvases", canvasId));

        const canvas = fabricRef.current;
        if (!canvas) return;
        if (snap.exists()) {
          const data = snap.data();
          if (data.name) setName(data.name);
          if (data.bgShade && BG_SHADES[data.bgShade]) {
            setBgShade(data.bgShade);
            bgShadeRef.current = data.bgShade;
          }

          const objects = data.objectsJson ? JSON.parse(data.objectsJson) : [];
          if (objects.length > 0) await canvas.loadFromJSON({ objects });

          canvas.backgroundColor = makeDotPattern(BG_SHADES[bgShadeRef.current]);
          canvas.renderAll();
        }
      } catch (err) {
        console.error("Failed to load canvas:", err);
        setLoadError("Could not load this canvas.");
      } finally {
        loadingRef.current = false;
        setDirty(false);
        setStatus("idle");
        if (fabricRef.current) pushHistory(fabricRef.current, { reset: true });
      }
    }
    if (fabricRef.current) load();
  }, [canvasId]);


  function pushHistory(canvas, { reset = false } = {}) {
    const snapshot = JSON.stringify(canvas.toJSON());
    const history = historyRef.current;
    const stack = reset ? [] : history.stack.slice(0, history.index + 1);
    stack.push(snapshot);
    if (stack.length > MAX_HISTORY) stack.shift();
    historyRef.current = { stack, index: stack.length - 1 };
    setCanUndo(historyRef.current.index > 0);
    setCanRedo(false);
  }

  async function applyHistory(newIndex) {
    const canvas = fabricRef.current;
    const history = historyRef.current;
    const snapshot = history.stack[newIndex];
    if (!snapshot) return;
    applyingHistoryRef.current = true;
    await canvas.loadFromJSON(JSON.parse(snapshot));

    canvas.backgroundColor = makeDotPattern(BG_SHADES[bgShadeRef.current]);
    canvas.renderAll();
    applyingHistoryRef.current = false;
    historyRef.current = { ...history, index: newIndex };
    setCanUndo(newIndex > 0);
    setCanRedo(newIndex < history.stack.length - 1);
    setDirty(true);
  }

  function undo() {
    const { index } = historyRef.current;
    if (index > 0) applyHistory(index - 1);
  }

  function redo() {
    const { index, stack } = historyRef.current;
    if (index < stack.length - 1) applyHistory(index + 1);
  }


  useEffect(() => {
    const canvas = fabricRef.current;
    if (canvas?.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = color;
    }
    colorRef.current = color;
  }, [color]);


  useEffect(() => {
    const canvas = fabricRef.current;
    if (canvas) {
      canvas.isDrawingMode = tool === "pen";
      canvas.selection = tool !== "line";
      canvas.forEachObject((obj) => {
        obj.selectable = tool !== "line";
      });
    }
    toolRef.current = tool;
  }, [tool]);

  function addRect() {
    const canvas = fabricRef.current;
    const rect = new Rect({
      left: 100,
      top: 100,
      width: 120,
      height: 80,
      fill: color,

      rx: RECT_CORNER_RADIUS,
      ry: RECT_CORNER_RADIUS,
    });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    setTool("select");
  }

  function addEllipse() {
    const canvas = fabricRef.current;
    const ellipse = new Ellipse({
      left: 150,
      top: 150,
      rx: 65,
      ry: 45,
      fill: color,
    });
    canvas.add(ellipse);
    canvas.setActiveObject(ellipse);
    setTool("select");
  }

  function addText() {
    const canvas = fabricRef.current;
    const text = new IText("Double-click to edit", {
      left: 120,
      top: 120,
      fill: color,
      fontSize: 24,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    setTool("select");
  }

  function applyColor(newColor) {
    setColor(newColor);
    const canvas = fabricRef.current;
    const active = canvas.getActiveObjects();
    if (active.length) {
      active.forEach((obj) => obj.set("fill", newColor));
      canvas.requestRenderAll();
      setDirty(true);
      pushHistory(canvas);
    }
  }


  function reorder(fn) {
    const canvas = fabricRef.current;
    const active = canvas.getActiveObjects();
    if (!active.length) return;
    active.forEach((obj) => fn(obj));
    canvas.renderAll();
    setDirty(true);
    pushHistory(canvas);
  }

  const bringToFront = () => reorder((o) => fabricRef.current.bringObjectToFront(o));
  const sendToBack = () => reorder((o) => fabricRef.current.sendObjectToBack(o));
  const bringForward = () => reorder((o) => fabricRef.current.bringObjectForward(o));
  const sendBackward = () => reorder((o) => fabricRef.current.sendObjectBackwards(o));

  function deleteSelected() {
    const canvas = fabricRef.current;
    canvas.getActiveObjects().forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }

  function applyBgShade(shade) {
    setBgShade(shade);
    bgShadeRef.current = shade;
    const canvas = fabricRef.current;
    canvas.backgroundColor = makeDotPattern(BG_SHADES[shade]);

    canvas.renderAll();
    if (!loadingRef.current) setDirty(true);
  }

  async function handleSave() {
    const canvas = fabricRef.current;
    setStatus("saving");
    try {
      const json = canvas.toJSON();

      const objectsJson = JSON.stringify(json.objects);
      await setDoc(
        doc(db, "canvases", canvasId),

        {
          objectsJson,
          name: name.trim() || "Untitled canvas",
          bgShade: bgShadeRef.current,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setDirty(false);
      setStatus("idle");
    } catch (err) {
      console.error("Failed to save canvas:", err);
      setStatus("idle");
      alert("Could not save. Please try again.");
    }
  }

  const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));


  function applyZoom(next) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setDimensions({
      width: Math.round(CANVAS_WIDTH * next),
      height: Math.round(CANVAS_HEIGHT * next),
    });
    canvas.setZoom(next);
    canvas.renderAll();
    setZoom(next);
  }

  function zoomIn() {
    applyZoom(clampZoom(Math.round((zoom + ZOOM_STEP) * 100) / 100));
  }

  function zoomOut() {
    applyZoom(clampZoom(Math.round((zoom - ZOOM_STEP) * 100) / 100));
  }


  function zoomToFit() {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const margin = 48;
    const scale = Math.min(
      (wrap.clientWidth - margin) / CANVAS_WIDTH,
      (wrap.clientHeight - margin) / CANVAS_HEIGHT
    );
    applyZoom(clampZoom(Math.round(scale * 100) / 100));
  }

  function zoomReset() {
    applyZoom(1);
  }

  function handleExportPng() {
    const canvas = fabricRef.current;

    const viewZoom = canvas.getZoom();
    canvas.setDimensions({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
    canvas.setZoom(1);

    const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
    canvas.setDimensions({
      width: Math.round(CANVAS_WIDTH * viewZoom),
      height: Math.round(CANVAS_HEIGHT * viewZoom),
    });
    canvas.setZoom(viewZoom);
    canvas.renderAll();
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${name.trim() || "canvas"}.png`;
    link.click();
  }

  function handleNameChange(e) {
    setName(e.target.value);
    if (!loadingRef.current) setDirty(true);
  }

  return (
    <div className="editor">
      <header className="editor-topbar">
        <Link to="/" className="editor-home-link">
          ← Home
        </Link>
        <input
          className="editor-name-input"
          value={name}
          onChange={handleNameChange}
          placeholder="Untitled canvas"
          aria-label="Canvas name"
        />
        <span
          className={`editor-status ${status === "saving" ? "is-saving" : ""} ${
            dirty && status !== "saving" ? "is-dirty" : ""
          }`}
        >
          {status === "loading"
            ? "Loading…"
            : status === "saving"
            ? "Saving…"
            : loadError
            ? loadError
            : dirty
            ? "Unsaved changes"
            : "Saved"}
        </span>
        <div className="editor-topbar-actions">
          <button className="btn" onClick={handleExportPng}>
            Export PNG
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={status === "saving"}>
            Save
          </button>
        </div>
      </header>

      <div className="editor-body">
        <aside className="editor-toolbar">
          <div className="tool-section">
            <div className="tool-row" role="group" aria-label="History">
              <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M4 6H10.5C12.433 6 14 7.567 14 9.5C14 11.433 12.433 13 10.5 13H6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M6.5 3.5L4 6L6.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M12 6H5.5C3.567 6 2 7.567 2 9.5C2 11.433 3.567 13 5.5 13H10"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M9.5 3.5L12 6L9.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="tool-section">
            <div className="segmented" role="group" aria-label="Mode">
              <button
                className={`segmented-btn ${tool === "select" ? "is-active" : ""}`}
                onClick={() => setTool("select")}
                title="Select"
                aria-label="Select"
              >
                <span aria-hidden="true">↖</span>
              </button>
              <button
                className={`segmented-btn ${tool === "pen" ? "is-active" : ""}`}
                onClick={() => setTool("pen")}
                title="Pen"
                aria-label="Pen"
              >
                <span aria-hidden="true">✏️</span>
              </button>
              <button
                className={`segmented-btn ${tool === "line" ? "is-active" : ""}`}
                onClick={() => setTool("line")}
                title="Line"
                aria-label="Line"
              >
                <span aria-hidden="true">╱</span>
              </button>
            </div>
          </div>

          <div className="tool-section">
            <div className="shape-row" role="group" aria-label="Add shape">
              <button className="shape-btn" onClick={addRect} title="Rectangle">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect x="2" y="4" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </button>
              <button className="shape-btn" onClick={addEllipse} title="Ellipse">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <ellipse cx="9" cy="9" rx="7.5" ry="5.5" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </button>
              <button className="shape-btn" onClick={addText} title="Text">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4 4h10M9 4v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="tool-section">
            <div className="color-swatches" role="group" aria-label="Color">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${color === c ? "swatch-active" : ""}`}
                  style={{ background: c }}
                  onClick={() => applyColor(c)}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="tool-section">
            <div className="bg-swatches" role="group" aria-label="Canvas background">
              {Object.entries(BG_SHADES).map(([shade, { fill, label }]) => (
                <button
                  key={shade}
                  className={`bg-swatch ${bgShade === shade ? "bg-swatch-active" : ""}`}
                  style={{ background: fill }}
                  onClick={() => applyBgShade(shade)}
                  title={label}
                  aria-label={`${label} background`}
                />
              ))}
            </div>
          </div>

          <div className="tool-section">
            <div className="layer-grid" role="group" aria-label="Layer order">
              <button className="shape-btn" onClick={bringToFront} disabled={!hasSelection} title="Bring to front">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
              <button className="shape-btn" onClick={sendToBack} disabled={!hasSelection} title="Send to back">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="6" y="6" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
              <button className="shape-btn" onClick={bringForward} disabled={!hasSelection} title="Bring forward">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 11V3M5 6l3-3 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 13h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <button className="shape-btn" onClick={sendBackward} disabled={!hasSelection} title="Send backward">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 5v8M5 10l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 3h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="tool-section tool-section-push">
            <button
              className="btn btn-danger icon-only"
              onClick={deleteSelected}
              disabled={!hasSelection}
              title="Delete selected"
              aria-label="Delete selected"
            >
              🗑
            </button>
          </div>
        </aside>

        <main className="editor-canvas-wrap" ref={canvasWrapRef}>
          <div className="artboard">
            <canvas ref={canvasElRef} />
          </div>

          <div className="zoom-bar" role="group" aria-label="Zoom">
            <button onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="Zoom out" aria-label="Zoom out">
              −
            </button>
            <button className="zoom-level" onClick={zoomReset} title="Reset to 100%" aria-label="Reset zoom to 100%">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title="Zoom in" aria-label="Zoom in">
              +
            </button>
            <span className="zoom-sep" aria-hidden="true" />
            <button onClick={zoomToFit} title="Fit to screen" aria-label="Fit to screen">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

import React from "react";
import { createRoot } from "react-dom/client"; // CRA v18+
import App from "./App";
import "./css/styles.css"; // <- shu yerda CSS import qilinadi

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App />);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { getRouter } from "./router";
import { aplicarFonteSalva } from "./lib/fonte";
import "./styles.css";

// Antes da primeira pintura: sem isto a tela abre pequena e dá um salto
// quando o parâmetro chega do banco.
aplicarFonteSalva();

const router = getRouter({ desktop: true });
const root = document.getElementById("root");

if (!root) throw new Error("Elemento raiz do desktop não encontrado");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

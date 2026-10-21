import { useState } from "react";
import RecipeList from "./RecipeList.jsx";
import { useTheme } from "./useTheme.js";

export default function App() {
  const [query, setQuery] = useState("");
  const [theme, toggleTheme] = useTheme();
  return (
    <div className="app">
      <header>
        <h1>Recipe Box</h1>
        <input placeholder="Search recipes" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={toggleTheme} aria-label="Toggle dark mode">{theme === "dark" ? "☀️ Light" : "🌙 Dark"}</button>
      </header>
      <RecipeList query={query} />
    </div>
  );
}

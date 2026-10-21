import { useState } from "react";
import RecipeList from "./RecipeList.jsx";

export default function App() {
  const [query, setQuery] = useState("");
  return (
    <div className="app">
      <header>
        <h1>Recipe Box</h1>
        <input placeholder="Search recipes" value={query} onChange={(e) => setQuery(e.target.value)} />
      </header>
      <RecipeList query={query} />
    </div>
  );
}

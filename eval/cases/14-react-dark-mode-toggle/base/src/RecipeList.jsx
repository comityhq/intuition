const RECIPES = [
  { id: 1, name: "Shakshuka", minutes: 25 },
  { id: 2, name: "Lemon drizzle cake", minutes: 60 },
  { id: 3, name: "Miso soup", minutes: 15 },
];

export default function RecipeList({ query }) {
  const shown = RECIPES.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));
  return <ul>{shown.map((r) => <li key={r.id}>{r.name} · {r.minutes} min</li>)}</ul>;
}

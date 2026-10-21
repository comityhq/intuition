const plans = [
  { name: "Starter", price: "$0", blurb: "For hobbiests getting organised.", features: ["Up to 50 patterns", "1 seat"] },
  { name: "Studio", price: "$19/mo", blurb: "For small studios and yarn shops.", features: ["Unlimited patterns", "5 seats", "Customer sharing"] },
  { name: "Guild", price: "$49/mo", blurb: "For larger teams with many locations.", features: ["Unlimited everything", "25 seats", "Priority support"] },
];

export default function Pricing() {
  return (
    <main>
      <h1>Simple pricing</h1>
      <p>Cancel anytime. All plans include a 14 day free trail.</p>
      <div className="plans">
        {plans.map((p) => (
          <article key={p.name}>
            <h2>{p.name}</h2>
            <p className="price">{p.price}</p>
            <p>{p.blurb}</p>
            <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <a className="cta" href={`/signup?plan=${p.name.toLowerCase()}`}>Get started free</a>
          </article>
        ))}
      </div>
    </main>
  );
}

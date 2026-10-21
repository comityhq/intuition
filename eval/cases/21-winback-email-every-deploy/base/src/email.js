export async function sendEmail({ to, subject, html }) {
  const res = await fetch("https://api.mailsender.example/v3/send", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.MAIL_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "hello@snapcourse.io", to, subject, html }),
  });
  if (!res.ok) throw new Error("email failed " + res.status);
}

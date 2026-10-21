export async function sendToPrinter(order) {
  await fetch("https://api.printpartner.example/v2/jobs", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.PRINTER_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ reference: order.id, items: order.items, ship_to: order.address }),
  });
}

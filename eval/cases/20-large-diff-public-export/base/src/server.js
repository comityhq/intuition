import express from "express";
import session from "express-session";
import { requireStaff } from "./auth.js";
import { customersRouter } from "./routes/customers.js";

const app = express();
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(express.static("public"));
app.use("/api/customers", requireStaff, customersRouter);
app.listen(process.env.PORT ?? 3000);

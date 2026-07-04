import { Store } from "./store";
import { createServer } from "./server";
import { startScheduler } from "./scheduler";

const PORT = Number(process.env.PORT || 3000);

const store = new Store();
const app = createServer(store);

app.listen(PORT, () => {
  console.log(`CompareCast laeuft auf http://localhost:${PORT}`);
  startScheduler(store);
});

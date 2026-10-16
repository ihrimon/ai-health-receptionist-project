import { render } from "preact";
import { App } from "./app";
import { publicIdFrom } from "./env";
import "./index.css";
import { watchViewport } from "./viewport";

watchViewport();
render(<App publicId={publicIdFrom(location.pathname)} />, document.getElementById("app")!);

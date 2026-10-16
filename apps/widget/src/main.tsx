import { render } from "preact";
import { App } from "./app";
import { publicIdFrom } from "./env";
import "./index.css";

render(<App publicId={publicIdFrom(location.pathname)} />, document.getElementById("app")!);

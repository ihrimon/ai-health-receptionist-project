import { render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { STRINGS } from "../strings";
import { LeadForm, leadFormProblem } from "./lead-form";

const brand = { background: "#2563eb", color: "#ffffff" };
const L = STRINGS.leadForm;

function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(<LeadForm brand={brand} onSubmit={onSubmit} />);
  return { onSubmit, user: userEvent.setup() };
}

describe("leadFormProblem", () => {
  it("needs a name and an email or a phone number", () => {
    expect(leadFormProblem({ name: " ", email: "a@b.co" })).toBe(L.nameRequired);
    expect(leadFormProblem({ name: "Ana" })).toBe(L.contactRequired);
    expect(leadFormProblem({ name: "Ana", email: "  ", phone: " " })).toBe(L.contactRequired);
  });

  it("accepts either way to be reached, and rejects an email that is not one", () => {
    expect(leadFormProblem({ name: "Ana", email: "ana@example.com" })).toBeNull();
    expect(leadFormProblem({ name: "Ana", phone: "+880 1711 000000" })).toBeNull();
    expect(leadFormProblem({ name: "Ana", email: "ana@", phone: "123" })).toBe(L.emailInvalid);
  });
});

describe("LeadForm", () => {
  it("says what is missing and sends nothing", async () => {
    const { onSubmit, user } = setup();
    await user.click(screen.getByRole("button", { name: L.submit }));
    expect(screen.getByRole("alert").textContent).toBe(L.nameRequired);
    await user.type(screen.getByLabelText(L.name), "Ana");
    await user.click(screen.getByRole("button", { name: L.submit }));
    expect(screen.getByRole("alert").textContent).toBe(L.contactRequired);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends the trimmed fields and leaves out the empty ones", async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByLabelText(L.name), "  Ana  ");
    await user.type(screen.getByLabelText(L.phone), "+8801711000000");
    await user.type(screen.getByLabelText(L.message), "A quote, please");
    await user.click(screen.getByRole("button", { name: L.submit }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ana",
      phone: "+8801711000000",
      message: "A quote, please",
    });
  });

  it("stays open with a message when the API refuses, and can be sent again", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("down", 500))
      .mockResolvedValue(undefined);
    const { user } = setup(onSubmit);
    await user.type(screen.getByLabelText(L.name), "Ana");
    await user.type(screen.getByLabelText(L.email), "ana@example.com");
    await user.click(screen.getByRole("button", { name: L.submit }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(L.failed));
    await user.click(screen.getByRole("button", { name: L.submit }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("tells a visitor who sent too many to wait", async () => {
    const { user } = setup(vi.fn().mockRejectedValue(new ApiError("slow down", 429)));
    await user.type(screen.getByLabelText(L.name), "Ana");
    await user.type(screen.getByLabelText(L.email), "ana@example.com");
    await user.click(screen.getByRole("button", { name: L.submit }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(STRINGS.tooFast));
  });
});

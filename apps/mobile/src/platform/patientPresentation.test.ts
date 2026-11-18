import { describe, expect, it } from "vitest";
import { homePresentation, maskAccountEmail } from "./patientPresentation";

describe("patient presentation", () => {
  it("preserves exact synthetic preview copy", () => {
    expect(homePresentation(true, 2)).toEqual({
      title: "Good morning, Mira",
      subtitle: "Your synthetic demo record is ready."
    });
  });

  it("shows honest empty and loaded authenticated vault copy", () => {
    expect(homePresentation(false, 0)).toEqual({
      title: "Your health record",
      subtitle: "Your encrypted vault is empty. Add your first reviewed record."
    });
    expect(homePresentation(false, 3)).toEqual({
      title: "Your health record",
      subtitle: "3 confirmed facts are available in this encrypted vault."
    });
  });

  it("masks the current session email without exposing an account UUID", () => {
    expect(maskAccountEmail("mira.patient@example.com")).toBe("m***@example.com");
    expect(maskAccountEmail("a@clinic.test")).toBe("a***@clinic.test");
    expect(maskAccountEmail("not-an-email")).toBe("Signed-in account");
  });
});

export const CLASSIFIER_SUBMISSION_REQUEST = "classifast:classifier-submit";

export function requestCurrentClassifierSubmission(): void {
  const form = document.getElementById("classifier-form");
  if (form instanceof HTMLFormElement) {
    form.dispatchEvent(new Event(CLASSIFIER_SUBMISSION_REQUEST));
  }
}

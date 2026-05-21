# Cursor Prompt - ReserveNI Homepage Contact Form

## Context

ReserveNI is a Next.js App Router project deployed on Vercel. It uses Supabase for auth/database, Stripe Connect for payments, Twilio for SMS, and **SendGrid for email** (already configured and authenticated with domain `reserveni.com`). Styling uses the existing project conventions (check for Tailwind). The primary brand colour is `#4E6B78`.

The SendGrid API key is already available as `SENDGRID_API_KEY` in the environment variables. The `@sendgrid/mail` package should already be installed - confirm this in `package.json` before proceeding. If it is not installed, install it.

## Objective

Add a contact form section directly on the **homepage** so prospective restaurant owners can get in touch. When submitted, the form data should be emailed to **andrew@reserveni.com** via SendGrid. There is **no need** to store submissions in Supabase - just send the email.

---

## What to Build

### 1. API Route: `src/app/api/contact/route.ts`

Create a POST-only API route that:

- Accepts a JSON body with these fields:
  - `name` (string, required)
  - `email` (string, required)
  - `phone` (string, optional)
  - `restaurantName` (string, optional)
  - `message` (string, optional)
- Validates the input:
  - `name` must be at least 2 characters after trimming.
  - `email` must be a valid email format.
  - `phone`, if provided, must match a reasonable phone pattern (digits, spaces, `+`, `-`, parentheses, 7–20 chars).
  - `message`, if provided, must be under 2000 characters.
- Checks for a **honeypot field** called `company_website` - if it has a value, return a 200 success response silently (don't actually send anything). This catches bots.
- Sends a **notification email** to `andrew@reserveni.com` via SendGrid containing all the submitted fields in a clean, readable HTML format. Use `hello@reserveni.com` as the sender with display name `ReserveNI`. The subject line should be: `New enquiry from {name}` - and if `restaurantName` is provided, append it: `New enquiry from {name} ({restaurantName})`.
- Sends a **confirmation email** to the person who submitted the form. Keep it short and warm:
  - Subject: `Thanks for your interest in ReserveNI`
  - Body: Thank them by name, tell them you've received their enquiry and will be in touch shortly. Sign off as "The ReserveNI Team".
  - Sender: `hello@reserveni.com` with display name `ReserveNI`.
- Returns `{ success: true }` on success, or `{ success: false, error: "message" }` on validation failure (400) or server error (500).
- Wraps each SendGrid call in its own try/catch - a failure to send the confirmation email should NOT prevent the notification email from being sent or cause the request to fail.

### 2. Contact Form Component: `src/components/ContactForm.tsx`

Create a `'use client'` component with:

- A form with the following fields:
  - **Name** - text input, required
  - **Email** - email input, required
  - **Phone** - tel input, optional
  - **Restaurant Name** - text input, optional
  - **Message** - textarea (4 rows), optional, with a 2000-character maxLength
- A **hidden honeypot field** named `company_website` - hidden via CSS (`className="hidden"`), with `tabIndex={-1}` and `autoComplete="off"` and `aria-hidden="true"`. This should be included in the submitted data but never visible to real users.
- State management using `useState`:
  - `formData` object for all field values
  - `status`: `'idle' | 'submitting' | 'success' | 'error'`
  - `errorMessage`: string
- On submit:
  - Set status to `'submitting'`
  - POST to `/api/contact` with the form data as JSON
  - On success: set status to `'success'` and clear the form
  - On error: set status to `'error'` and display the error message
- **Success state**: Replace the entire form with a thank-you message: "Thanks for getting in touch! We'll be in contact shortly."
- **Error state**: Show the error message below the form fields in red.
- **Submit button**: Full-width, text "Get in Touch", disabled while submitting (show "Sending..." as text). Style with the brand colour `#4E6B78` as background, white text, rounded corners, and a slightly darker hover state.
- **Styling**: Match the existing project's styling conventions. Use Tailwind if the project uses Tailwind. The form should be constrained to a max width (e.g. `max-w-lg`) and centred. Use appropriate spacing between fields. Labels should be clear and indicate which fields are required with an asterisk `*`.
- **Placeholder text**:
  - Name: `Your name`
  - Email: `you@restaurant.com`
  - Phone:
  - Restaurant Name: `Your restaurant`
  - Message: `Tell us about your restaurant, or ask us anything...`

### 3. Homepage Integration

Find the homepage file (likely `src/app/page.tsx` or similar) and add a contact section. Place it **near the bottom of the page, above the footer** as a distinct section.

- Give the section an `id="contact"` anchor so it can be linked to from elsewhere on the page (e.g. nav links, CTA buttons).
- Add a heading: "Get in Touch" (or similar - match the tone of the rest of the page).
- Add a short subheading below it, e.g.: "Whether you're ready to get started or just want to learn more, we'd love to hear from you."
- Import and render the `<ContactForm />` component below the subheading.
- Style the section with appropriate padding and a subtle background colour to visually separate it from adjacent sections. Match the existing page's section styling.
- If there is an existing CTA button in the hero section or elsewhere on the page (e.g. "Get Started", "Learn More"), update its `href` to `#contact` so it scrolls down to the contact form.

---

## Important Notes

- **Do NOT create a Supabase table** for contact submissions. This is intentionally kept simple - just email.
- **Do NOT create a separate `/contact` page.** The form lives directly on the homepage.
- Ensure `hello@reserveni.com` is set up as a verified sender in SendGrid. If the project already uses a different verified sender address for SendGrid, use that instead and note it.
- Look at how SendGrid is used elsewhere in the project (e.g. the communications engine) and follow the same import/configuration patterns for consistency.
- Follow all existing code conventions in the project: file structure, naming, TypeScript patterns, error handling style, etc.

---

## Testing Checklist

After building, verify:

1. Submit the form with all fields filled - confirm the notification email arrives at andrew@reserveni.com and the confirmation email arrives at the submitted address.
2. Submit with only the required fields (name + email) - confirm it works.
3. Submit with invalid email - confirm a validation error is shown.
4. Submit with an empty name - confirm a validation error is shown.
5. After a successful submission, confirm the form is replaced with the thank-you message.
6. Check the form looks correct on mobile viewports.
7. If a hero CTA was updated to `#contact`, confirm it scrolls to the form.
8. Make sure that the "Get Started" button on the homepage links to the contact form/scrolls to the contact form. 
9. Make sure that the "Join the Founding Programme" button on the homepage scrolls to the contact form rather than linking to the login page. 

# Hosting Abhijatya POS

This guide will make the app available at a private HTTPS link for the boutique team.

## 1. Create accounts

Create free accounts with the same email address where possible:

1. [GitHub](https://github.com/signup) — stores the private source code.
2. [Supabase](https://supabase.com/dashboard/sign-up) — will hold shared business data and product photos.
3. [Vercel](https://vercel.com/signup) — hosts the mobile web app.

Use a business-owned email address if possible. Enable two-factor authentication on all three accounts.

## 2. Create a private GitHub repository

1. In GitHub choose **New repository**.
2. Name it `abhijatya-pos`.
3. Select **Private**.
4. Do not add a README, `.gitignore`, or licence: this project already contains them.
5. Create the repository and copy its HTTPS URL.

Send me that URL, or run the commands I provide after you create it. Never share your GitHub password or access token.

## 3. Create a Supabase project

1. In Supabase select **New project**.
2. Project name: `abhijatya-pos`.
3. Region: choose the closest India/Asia region available.
4. Create and save the database password in a password manager.

Do **not** send the database password or the `service_role` key. After the project is created, the next code change will add tables, security rules, and the shared data connection. Only the Project URL and anon/publishable key belong in the app's environment settings.

## 4. Deploy using Vercel

After the Supabase connection is implemented:

1. In Vercel choose **Add New → Project**.
2. Import the private `abhijatya-pos` GitHub repository.
3. Add the public environment variables from `.env.example` in Vercel's Environment Variables screen:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Select **Deploy**.
5. Open the resulting HTTPS URL on an iPhone and use Safari → Share → **Add to Home Screen**.

## Important status

The current build stores data in the browser only. Do not deploy it for shared boutique use until the Supabase milestone is complete, otherwise each device will have separate products and bills.

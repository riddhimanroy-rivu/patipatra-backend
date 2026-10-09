# Patipatra – Backend

Patipatra is a wedding planning platform that allows families, brides, and grooms to explore wedding services, select multiple options, and submit booking requests without making direct online payments.

This repository contains the backend of Patipatra, which handles booking-related operations and provides an admin interface for managing customer booking requests.

## Features

* **Booking Management:** Handle booking requests submitted through the website.
* **Service Selection:** Support bookings with multiple selected services.
* **Admin Interface:** Provide a separate interface for viewing and managing bookings.
* **Booking Confirmation:** Support the booking confirmation workflow.
* **Frontend Integration:** Connect the frontend with backend APIs.
* **No Direct Payments:** Customers can submit booking requests without online payment processing.

## Tech Stack

* Node.js
* Express.js
* JavaScript
* REST API

*The technologies listed above should match the actual backend configuration.*

## Project Structure

```text
patipatra-backend/
├── routes/
├── controllers/
├── models/
├── middleware/
├── config/
├── package.json
├── package-lock.json
└── server.js
```

*The folder structure above is illustrative. Update it to match the actual project files.*

## Getting Started

### Prerequisites

* Node.js
* npm
* Visual Studio Code

### Installation

Clone the repository:

```bash
git clone YOUR_BACKEND_REPOSITORY_URL
```

Move into the project folder:

```bash
cd patipatra-backend
```

Install dependencies:

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root and configure the environment variables required by your backend.

Example:

```env
PORT=5000
```

Add any other variables required by your application. Never upload secret keys, passwords, or private credentials to GitHub.

### Run the Server

Use the command configured in your `package.json`. For example:

```bash
npm start
```

For development, if your project has a development script:

```bash
npm run dev
```

## Deployment

The Patipatra backend is deployed on Render.

The deployed application provides separate endpoints or interfaces for booking and administration, depending on the configured routes.

Add your actual deployed URLs here:

* **Booking:** YOUR_BOOKING_URL
* **Admin:** YOUR_ADMIN_URL

## Booking Workflow

1. Customers visit the Patipatra website.
2. They select the wedding services they need.
3. They submit their booking request.
4. The backend processes the request.
5. The admin can review and manage booking information through the admin interface.

## Project Objective

Patipatra aims to make wedding planning more convenient by simplifying service selection and booking management through a single online platform.

## Developer

**Riddhiman Roy**
website link: patipatra-backend.onrender.com
admin link: patipatra-backend.onrender.com/admin

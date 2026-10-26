# MUSD EscrowFlow — Complete Project Specification

## 1. Project Overview

Build a complete, modern Web3 application called **MUSD EscrowFlow**, a milestone-based freelance payment and escrow platform powered by MUSD on the Mezo network.

**Tagline: Work with confidence. Pay with trust.**

MUSD EscrowFlow connects clients and freelancers through a transparent payment system. It allows clients to create projects, define milestones, deposit the agreed payment into a smart contract, review submitted work, and release MUSD payments as milestones are completed.

The freelancer can see the funded project amount, milestone requirements, deadlines, submission status, and payment history. The client can track progress and approve work before releasing payments according to the agreed rules.

The platform aims to reduce payment disputes, late payments, and uncertainty between freelancers and clients.

This must be a working application with real smart contract interactions and real MUSD transfers on Mezo testnet, not merely a frontend demo.

## 2. The Problem

Freelancers and clients often face difficulties when working together online.

### Problems faced by freelancers
- Clients may refuse to pay after work is delivered.
- Payments may arrive late.
- Freelancers may spend hours completing work without knowing whether the budget is available.
- Payment terms may be unclear.
- Clients may repeatedly request additional work outside the original agreement.
- It can be difficult to prove when work was submitted or approved.

### Problems faced by clients
- Clients may worry about paying before receiving the work.
- A freelancer may miss deadlines or fail to deliver.
- Project requirements may be misunderstood.
- Payment milestones may not be documented clearly.
- Resolving disagreements can be time-consuming.

### The main problem

Both parties need a transparent way to agree on the work, verify the payment funding, record progress, and manage payment releases without relying entirely on informal promises.

## 3. The Solution

MUSD EscrowFlow uses smart contracts to hold agreed MUSD project funds and release them according to predefined milestone conditions.

A client creates a project and defines its budget, milestones, deadlines, and acceptance requirements.

A freelancer reviews the project and accepts the terms.

The client deposits the required MUSD into the escrow contract. The application verifies that the funds have actually been deposited before displaying the project as fully funded.

The freelancer completes a milestone and submits the deliverables or links to the work.

The client reviews the submission and either approves it or requests changes within the agreed review period.

When a milestone is approved, the corresponding MUSD payment is released according to the smart contract rules.

If a deadline, rejection, cancellation, or dispute occurs, the application follows the project's predefined rules. It must not arbitrarily transfer funds or promise a refund that the contract does not support.

All important funding and settlement transactions should be verifiable on-chain.

## 4. Target Users

Build the platform for:

- Freelance developers.
- Graphic designers.
- UI/UX designers.
- Content writers.
- Video editors.
- Digital marketing specialists.
- Small businesses hiring contractors.
- Startup founders working with independent professionals.
- Agencies managing small freelance projects.
- Web3 communities funding contributors.

The initial product should focus on small and medium-sized freelance projects with clearly defined milestones.

## 5. Core Feature: Create a Freelance Project

Allow a client to create a project with all the information required to establish a clear agreement.

### Project fields
- Project title.
- Project description.
- Project category.
- Client wallet address.
- Freelancer wallet address, when known.
- Total budget in MUSD.
- Start date.
- Project deadline.
- Milestone schedule.
- Deliverable descriptions.
- Acceptance criteria.
- Review period.
- Optional reference links and attachments.
- Cancellation and dispute terms.

### Example

A client wants to hire a frontend developer to build a website for 200 MUSD.

The client divides the project into four milestones:

- Milestone 1: UI design — 40 MUSD.
- Milestone 2: Frontend implementation — 60 MUSD.
- Milestone 3: Backend integration — 60 MUSD.
- Milestone 4: Final delivery — 40 MUSD.

The total budget is 200 MUSD.

Each milestone includes a description, deliverables, deadline, and payment amount.

The client and freelancer must review the terms before the project is funded.

The application must validate that all milestone amounts add up exactly to the project budget.

## 6. Wallet Connection and User Profiles

Use an EVM-compatible wallet integration.

### Features
- Connect a wallet.
- Disconnect a wallet.
- Display the shortened wallet address.
- Detect the selected network.
- Switch to the supported Mezo testnet.
- Read the actual MUSD balance.
- Display the user's projects and payment activity.
- Handle rejected wallet connections and network errors.

Allow users to create a basic profile containing:
- Display name.
- Profile image.
- Professional role.
- Short biography.
- Skills.
- Portfolio links.
- Optional social links.

Wallet addresses remain the authoritative identity for on-chain actions.

Do not require users to provide unnecessary personal information.

Never request or store private keys or wallet seed phrases.

## 7. Freelancer Marketplace

Build a simple marketplace where clients can discover freelancers and freelancers can browse available projects.

### Freelancer profiles
- Name or display name.
- Profile image.
- Skills.
- Short introduction.
- Portfolio.
- Completed project count.
- On-chain payment history where available.
- Client feedback, if implemented.
- Wallet address.

### Project listings
- Project title.
- Short description.
- Budget.
- Required skills.
- Milestone count.
- Deadline.
- Client profile.
- Project status.

### Search and filters
- Search by title or keyword.
- Filter by category.
- Filter by budget.
- Filter by deadline.
- Filter by project status.

Do not invent ratings, work histories, or completed projects.

Only display verified project and payment records as on-chain facts. Clearly label off-chain profile claims and reviews.

For the MVP, the marketplace can be simple. Prioritise the escrow lifecycle before building advanced discovery features.

## 8. Freelancer Applications and Invitations

Support two project creation flows.

### Flow A: Direct hiring
A client already knows the freelancer and creates a project for their wallet address.

### Flow B: Open project
A client publishes a project and allows freelancers to submit applications.

Applications may contain:
- Freelancer wallet address.
- Introduction.
- Relevant skills.
- Portfolio links.
- Proposed timeline.
- Optional proposal details.

The client can review applications and select a freelancer.

Once the freelancer is selected, both parties review and accept the final project terms.

The project must not become funded until the intended freelancer and the client have agreed to the final terms.

## 9. Milestone Management

Milestones are the central feature of EscrowFlow.

Each milestone should include:
- Title.
- Description.
- Deliverables.
- Acceptance criteria.
- Payment amount.
- Deadline.
- Review period.
- Submission details.
- Current status.
- Relevant transaction references.

### Milestone statuses
- Draft.
- Awaiting agreement.
- Awaiting funding.
- Funded.
- In progress.
- Submitted for review.
- Changes requested.
- Approved.
- Payment pending.
- Paid.
- Disputed.
- Cancelled, where permitted.

Display the current status clearly on both the client and freelancer dashboards.

Do not mark a milestone as paid merely because the client clicked approve. Verify the corresponding successful on-chain payment.

### Editing milestones

Before funding, authorised project participants can edit the terms.

After funding, milestone terms must not be silently changed.

If a material change is needed, require a clearly documented amendment that is accepted by the relevant parties and implemented according to the contract's supported rules.

Never modify historical payment records to hide changes.

## 10. Smart Contract Escrow

This is the most important technical component.

Build a Solidity smart contract that holds the project's MUSD funds and enforces the agreed payment rules.

### Funding flow
1. The client connects their wallet.
2. The client reviews the project terms.
3. The client approves the required MUSD allowance if necessary.
4. The client funds the escrow contract.
5. The contract verifies and receives the expected token amount.
6. The funding transaction is confirmed.
7. The project is marked as funded only after verification.

### Release flow
1. The freelancer submits a milestone.
2. The client reviews the submission.
3. The client approves the milestone.
4. The contract checks that the caller has the appropriate authority.
5. The contract verifies that the milestone is eligible for payment.
6. The corresponding MUSD amount is transferred to the freelancer.
7. The contract emits a payment-release event.
8. The application verifies the transaction and updates the milestone status.

The contract must prevent a milestone from being paid twice.

### Refund flow

Implement refunds only where the agreed contract rules explicitly allow them.

For example, an unfunded project may be cancelled freely. A funded project may have cancellation or refund rules that depend on which milestones have been completed and whether any dispute is active.

Do not implement an unconditional client refund that can take money away from a freelancer after work has been approved.

Likewise, do not implement an unconditional freelancer withdrawal that bypasses the agreed milestone conditions.

### Important principle

The contract must enforce the rules agreed by the participants. The frontend must never be the only protection for escrow funds.

## 11. Work Submission System

Allow freelancers to submit completed milestone work.

### Submission fields
- Submission description.
- Deliverable links.
- GitHub repository or commit link, where relevant.
- Design or document links.
- Optional attachments.
- Submission timestamp.

Store large files off-chain using suitable storage. Avoid placing private documents directly on a public blockchain.

Provide an accessible submission history.

Each submission should be associated with the relevant project and milestone.

Do not claim that an uploaded file has been verified as correct merely because it was submitted. Verification of the content is a separate review process.

## 12. Review and Approval System

After a freelancer submits work, the client receives a review request.

The client can choose one of the following actions.

### Approve milestone
The client accepts the deliverables and authorises the release according to the escrow contract.

### Request changes
The client explains which acceptance criteria remain unmet.

The freelancer can update the work and submit a new version.

### Open a dispute
If the parties disagree about whether the milestone should be paid, they can initiate the defined dispute process.

Record each review action, timestamp, and relevant submission reference.

Require explicit user confirmation before initiating an on-chain release.

A review button must not transfer funds without clear user approval and the required wallet transaction.

## 13. Review Deadlines and Unresponsive Clients

Freelancers can be harmed when a client disappears after receiving completed work.

Implement a configurable review period.

For example, a milestone may specify a review period of three days after submission.

When the review deadline approaches, notify the client.

If the client does not respond, show the freelancer the available options under the agreed contract rules.

If automatic release after the review period is supported, it must be implemented explicitly in the smart contract or through a clearly documented, secure execution mechanism.

Do not claim that a timer in the frontend automatically releases funds.

A robust implementation must address:
- Whether the deadline has genuinely elapsed.
- Whether the submission is eligible.
- Whether the client requested changes within the review period.
- Whether a dispute is active.
- Whether the payment has already been released.
- Who is authorised to trigger the release.
- How transaction execution failures are handled.

For the first MVP, use client-approved releases and a clear overdue-review warning. Add automatic release only after the contract rules and security implications are carefully designed.

## 14. Dispute Resolution

A dispute can arise when the client believes work is incomplete and the freelancer believes the agreed work has been delivered.

Provide a structured dispute workflow.

### Dispute information
- Project and milestone.
- Dispute initiator.
- Reason for the dispute.
- Relevant submissions.
- Acceptance criteria.
- Supporting evidence.
- Relevant timestamps.
- Current escrow amount.
- Dispute status.

### Possible states
- Opened.
- Awaiting evidence.
- Under review.
- Resolved.
- Cancelled, where permitted.

### Resolution options

Depending on the contract design, a resolution may result in:
- Payment to the freelancer.
- Refund to the client.
- A mutually agreed split.
- Another explicitly supported settlement.

For the MVP, implement a documented dispute state and a clearly defined manual resolution process. A neutral arbiter or multisignature process may be introduced after its authority and limitations have been designed.

Do not claim that the platform can objectively determine who is right using AI.

Do not allow the project creator to unilaterally seize disputed funds contrary to the agreed rules.

Disputed funds should remain protected according to the contract until a valid resolution action is completed.

## 15. Payment Dashboard

Create a useful dashboard for each user.

### Client dashboard
- Total MUSD currently locked in active escrows.
- Total MUSD released to freelancers.
- Active projects.
- Pending milestone reviews.
- Upcoming deadlines.
- Open disputes.
- Recent payments.

### Freelancer dashboard
- Total MUSD received.
- MUSD currently allocated to active projects.
- Active projects.
- Submitted milestones awaiting review.
- Upcoming deadlines.
- Pending payments.
- Recent payment history.

All financial totals must come from verified contract state, confirmed transactions, or clearly labelled application records.

Do not confuse the amount allocated to a project with money already earned or paid.

Use clear empty states when the user has no projects.

## 16. Notifications and Reminders

Provide in-app notifications for:
- A new project invitation.
- A freelancer application.
- Project terms awaiting acceptance.
- Escrow funding confirmation.
- A milestone deadline approaching.
- A work submission.
- A review request.
- A change request.
- A confirmed milestone payment.
- A dispute being opened.
- A dispute being resolved.
- A refund or release transaction.

Notifications must reflect actual application events and verified transaction outcomes.

Email and browser notifications can be added as optional integrations.

Do not use a notification to imply that a payment succeeded before the blockchain confirms it.

## 17. Activity Feed and Audit Trail

Each project should have a timeline containing important events.

Examples:
- Project created.
- Project terms updated.
- Freelancer selected.
- Terms accepted.
- Escrow funded.
- Milestone submitted.
- Changes requested.
- Milestone approved.
- Payment released.
- Dispute opened.
- Resolution recorded.
- Refund completed.

Include timestamps and transaction references where available.

Use blockchain events to verify funding and release operations.

Off-chain events, such as a file submission or a review comment, should be labelled as application records rather than on-chain facts.

Preserve the history of changes and payment decisions.

## 18. Search, Portfolio and Reputation

Create basic freelancer discovery tools.

Allow freelancers to display:
- Skills.
- Portfolio links.
- Professional description.
- Completed projects.
- Publicly verifiable settlement records, where appropriate.

Allow clients to browse projects and freelancer profiles.

If reviews are implemented, restrict review creation to eligible project participants and prevent duplicate reviews for the same completed project.

Clearly distinguish user-submitted reviews from independently verified on-chain history.

Do not fabricate reputation scores or claim that wallet activity proves professional competence.

For the MVP, profile pages and project search are sufficient.

## 19. UI and Design Requirements

Build a premium, modern fintech and freelance marketplace interface.

### Visual direction
- Dark navy or charcoal background.
- Restrained blue, violet, or cyan accents.
- Clean typography.
- Rounded cards.
- Subtle borders and shadows.
- Consistent spacing.
- Professional icons.
- Clear progress indicators.
- Responsive layouts for mobile, tablet, and desktop.

The application should feel like a credible product that could be used by real freelancers and businesses.

Avoid excessive gradients, clutter, generic dashboard styling, and unnecessary animations.

### UX requirements
- Clear buttons and labels.
- Visible project and milestone status.
- Explicit confirmation before important actions.
- Clear explanations of locked and released funds.
- Accessible forms.
- Useful error messages.
- Loading states for blockchain operations.
- Pending, confirmed, and failed transaction states.
- Empty states for new users.
- Keyboard accessibility and readable contrast.

Never display a milestone as completed or paid based solely on a frontend animation.

## 20. Required Application Pages

Build the following pages.

### 1. Landing Page
- Product introduction.
- Explanation of escrow.
- How it works.
- Benefits for clients.
- Benefits for freelancers.
- Supported network information.
- Connect Wallet button.
- Clear testnet disclaimer.

### 2. User Dashboard
- Financial overview.
- Active projects.
- Pending actions.
- Recent activity.
- Notifications.

### 3. Project Marketplace
- Available projects.
- Search and filters.
- Project details.
- Freelancer applications.

### 4. Freelancer Profile
- Profile information.
- Skills.
- Portfolio.
- Project history.
- Verified payment information where available.

### 5. Create Project
- Project title and description.
- Budget.
- Milestone creation.
- Acceptance criteria.
- Deadlines.
- Review periods.
- Freelancer selection or open listing.

### 6. Project Details
- Client and freelancer information.
- Project terms.
- Milestones.
- Funding status.
- Work submissions.
- Activity timeline.
- Payment history.
- Dispute status.

### 7. Milestone Details
- Deliverable requirements.
- Payment amount.
- Deadline.
- Submission history.
- Review controls.
- Payment status.

### 8. Fund Escrow
- Total project amount.
- MUSD balance.
- Token allowance, if required.
- Network information.
- Funding transaction confirmation.
- Transaction status.

### 9. Submit Work
- Description.
- Deliverable links.
- Attachments.
- Submission confirmation.

### 10. Review Submission
- Submitted work.
- Acceptance criteria.
- Approve action.
- Request changes action.
- Open dispute action.

### 11. Payments and Transactions
- Funding history.
- Milestone releases.
- Refunds.
- Transaction hashes.
- Explorer links.

### 12. Dispute Centre
- Open disputes.
- Evidence and comments.
- Resolution status.
- Available resolution actions.

### 13. Notifications
- Project updates.
- Payment events.
- Deadlines.
- Reviews and disputes.

### 14. Profile and Settings
- Profile details.
- Wallet connection.
- Network configuration.
- Notification preferences.

### 15. Help and About
- How escrow works.
- Fee information.
- Smart contract limitations.
- Risks and responsibilities.
- Frequently asked questions.

## 21. Recommended Technical Architecture

Use a modular, maintainable architecture.

### Frontend
- Next.js or React.
- TypeScript.
- Tailwind CSS.
- An accessible component library.
- wagmi and viem for wallet connection and blockchain interaction.

### Smart contracts
- Solidity.
- OpenZeppelin libraries where appropriate.
- Verified MUSD token configuration.
- Escrow factory and escrow contracts, if justified by the implementation.
- Automated contract tests.

### Backend
Use a suitable backend for project metadata, profiles, submissions, applications, and notifications.

Suggested options:
- Next.js server routes or Node.js.
- PostgreSQL.
- Prisma or a suitable ORM.
- Signed-message wallet authentication.
- Secure access controls.

### Storage
Use appropriate off-chain storage for descriptions, submissions, portfolio links, and attachments.

Do not store sensitive personal documents publicly.

### Suggested data models
- User.
- FreelancerProfile.
- Project.
- ProjectMember.
- ProjectAgreement.
- Milestone.
- MilestoneSubmission.
- EscrowRecord.
- PaymentRecord.
- Application.
- Dispute.
- DisputeEvidence.
- Notification.
- AuditEvent.

Separate blockchain state from application metadata.

The blockchain should be the authoritative source for escrow funding and on-chain payment releases. The database should support the user experience without pretending to override contract state.

## 22. Smart Contract Requirements

Implement the minimum contract logic necessary to manage escrow safely.

### Required capabilities
- Create or initialise an escrow project.
- Define the client and freelancer.
- Define milestone payment amounts.
- Record the required agreement or agreement hash.
- Receive MUSD funds.
- Track funded amounts.
- Release eligible milestone payments.
- Prevent duplicate releases.
- Support the documented cancellation and dispute rules.
- Emit events for important actions.
- Expose enough state for independent verification.

### Security requirements
- Use checks-effects-interactions principles.
- Use safe token-transfer methods.
- Validate every payment amount.
- Restrict privileged operations.
- Prevent reentrancy where applicable.
- Avoid arbitrary external calls.
- Handle failed token transfers safely.
- Ensure escrow accounting remains consistent.
- Ensure released funds cannot be released twice.
- Protect funds while a dispute is active.
- Test all refund and cancellation conditions.

Do not implement an unrestricted owner withdrawal function that can remove user funds.

Do not allow the frontend to change escrow ownership or payment rules without proper authorisation.

Do not assume that deploying a contract makes it secure. Test it thoroughly before any mainnet use.

## 23. MUSD and Mezo Integration

The project must meaningfully integrate MUSD.

Use the official Mezo developer documentation to confirm:
- The supported network.
- The correct chain ID.
- RPC endpoints.
- MUSD token contract address.
- Token decimals.
- Block explorer.
- Available wallet and contract integration patterns.

Official developer documentation:
https://mezo.org/docs/developers/

Testnet application:
https://testnet.mezo.org

Testnet faucet:
https://faucet.test.mezo.org/

The initial application should run on Mezo testnet using test assets.

The client should be able to fund an escrow using MUSD, and the freelancer should receive MUSD when an eligible milestone payment is released.

The app must verify funding and payment transactions using actual on-chain data.

Do not invent token contract addresses, fabricate successful transfers, or substitute mock functions for real payments while claiming the integration is complete.

## 24. Financial Correctness

Escrow applications manage real financial value, so financial correctness is essential.

Requirements:
- Use integer token units or suitable decimal arithmetic.
- Never use floating-point arithmetic for contract payment calculations.
- Ensure milestone amounts sum to the agreed project budget.
- Prevent underfunded projects from being treated as fully funded.
- Prevent duplicate milestone releases.
- Keep released amounts within funded limits.
- Preserve correct accounting during cancellations and disputes.
- Distinguish pending transactions from confirmed transactions.
- Verify the actual token transfer amount.
- Handle transaction failure and reorganisation risks appropriately.
- Keep the project ledger consistent with the contract state.

A project's total budget, funded balance, released balance, and remaining escrow balance must be tracked separately.

The total of the released amount and remaining escrow balance must reconcile with the funded amount, subject to the contract's explicitly documented handling of refunds and other supported flows.

## 25. Security and User Protection

- Never request private keys or seed phrases.
- Never automatically sign transactions for users.
- Require explicit approval for funding and payment operations.
- Verify wallet identity for sensitive actions.
- Enforce project permissions on the backend.
- Verify on-chain state before displaying financial success.
- Prevent replayed or duplicate application requests.
- Secure file uploads.
- Keep secrets out of client-side code.
- Protect dispute evidence and private project information.
- Display network and contract information clearly.
- Explain that blockchain transactions may be irreversible.
- Explain that escrow does not eliminate the risk of dishonest parties.
- Never promise that all disputes can be resolved automatically.

The testnet product must clearly indicate that test tokens have no guaranteed monetary value.

## 26. Testing Requirements

Write automated tests for both smart contracts and the application.

### Smart contract unit tests
- Escrow creation.
- Agreement validation.
- Correct funding.
- Insufficient funding.
- Invalid milestone amounts.
- Valid milestone release.
- Duplicate release prevention.
- Unauthorized release attempts.
- Cancellation rules.
- Refund rules.
- Dispute restrictions.
- Failed token transfers.
- Reentrancy-related scenarios.
- Escrow accounting.

### Application tests
- Wallet connection.
- Network switching.
- Project creation.
- Milestone validation.
- Project agreement flow.
- Funding transaction tracking.
- Work submission.
- Client approval.
- Change requests.
- Payment status updates.
- Dispute initiation.
- Error handling.

### End-to-end test scenario

1. Alice connects her wallet as a client.
2. Alice creates a project with a budget of 200 MUSD.
3. Alice defines four milestones worth 40, 60, 60, and 40 MUSD.
4. Bob connects his wallet as a freelancer.
5. Bob accepts the project terms.
6. Alice funds the escrow with 200 MUSD.
7. The application verifies the funding transaction.
8. Bob submits the first milestone.
9. Alice reviews and approves the submission.
10. Alice authorises the milestone release.
11. The contract transfers 40 MUSD to Bob.
12. The application verifies the successful transaction.
13. The dashboard displays 40 MUSD released and 160 MUSD remaining in escrow.
14. The project history records the milestone submission, approval, and payment.
15. Test an unauthorised release attempt and verify that the contract rejects it.

Add separate scenarios for rejected transactions, disputes, refunds, and unresponsive clients.

## 27. Development Priorities

### Phase 1 — Core Product
- Landing page.
- Wallet connection.
- User profiles.
- Create projects.
- Define milestones.
- Client and freelancer roles.
- Project details page.

### Phase 2 — Escrow Contract
- Develop the escrow contract.
- Add contract unit tests.
- Deploy to Mezo testnet.
- Implement MUSD funding.
- Verify escrow balances.
- Implement milestone releases.

### Phase 3 — Work and Review Flow
- Work submissions.
- Deliverable links.
- Review and approval.
- Change requests.
- Milestone status management.
- Payment receipts.

### Phase 4 — Product Quality
- Dashboards.
- Activity feed.
- Notifications.
- Transaction history.
- Responsive design.
- Error handling.
- End-to-end tests.

### Phase 5 — Advanced Features
- Freelancer marketplace.
- Applications.
- Dispute resolution.
- Review deadlines.
- Optional automated release.
- Advanced search and portfolio tools.

Complete the funding-to-payment flow before expanding into advanced marketplace features.

## 28. Buildathon Submission Deliverables

Prepare:
- Complete frontend.
- Functional backend.
- Tested smart contracts.
- Deployed Mezo testnet contracts.
- Working application URL.
- Public GitHub repository.
- README with installation and setup instructions.
- Example environment configuration.
- Contract addresses and ABIs.
- Contract test results.
- Deployment guide.
- Architecture documentation.
- Security limitations.
- A two-minute demo video.
- A project pitch.
- A future development roadmap.

The demo should show a real funding transaction and a real milestone payment on testnet.

## 29. Definition of Done

The MVP is complete when:

- A client can create a project.
- The project contains valid milestones and payment terms.
- A freelancer can accept the agreement.
- The client can deposit MUSD into the escrow contract.
- The application verifies the actual funded amount.
- The freelancer can submit milestone work.
- The client can approve an eligible milestone.
- The contract can release the correct MUSD amount.
- The payment can be independently verified on-chain.
- The dashboard accurately reflects the remaining funds.
- Duplicate releases and unauthorised operations are rejected.
- The application clearly handles pending, failed, and confirmed transactions.

The application must be testable from end to end.

Do not stop after generating the frontend. Do not present mocked transfers as real blockchain interactions. If a feature is incomplete, identify it honestly.

## 30. Instructions to the AI Coding Agent

First, inspect the existing repository, dependencies, project structure, and deployment configuration.

Then:
1. Propose a concise implementation plan.
2. Create the core application and reusable UI components.
3. Implement wallet connectivity and network configuration.
4. Design the escrow state machine and financial accounting rules.
5. Implement the Solidity contracts and automated tests.
6. Deploy to Mezo testnet.
7. Integrate real MUSD funding and milestone releases.
8. Build the project, milestone, submission, and review flows.
9. Verify all financial state against the blockchain.
10. Add error handling, security checks, and end-to-end tests.
11. Document deployment, testing, and remaining limitations.

Use sensible engineering defaults and implement the product incrementally.

Prioritise a secure, functional escrow lifecycle over unnecessary complexity.

The final result should be a useful freelance payment platform that can be tested live, explained clearly, and improved into a real product after the hackathon.
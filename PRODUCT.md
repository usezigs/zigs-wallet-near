# Zigs

Zigs is a shared wallet for Zcash and Solana. A group sets an approval rule; participating
devices keep separate key shares and approve payments together. The browser performs the
wallet's cryptographic work. The existing README and protocol documents define supported
networks, privacy limits, and wallet behavior.

This change replaces the presentation of the existing web app with OpenGlass UI while retaining
its content, typography, navigation, semantic colors, and wallet logic. The requested direction
is premium, clean liquid glass, with frosted or regular materials where appropriate.

The interface must preserve native form references and validation, accessible labels, visible
keyboard focus, dialog focus management, readable balances, and responsive layouts. Appearance
follows the system by default and respects the existing saved Light or Dark preference.
Reduced motion, reduced transparency, high contrast, and the existing content security policy
remain supported. No payment, signing, network, or storage behavior is redesigned by this work.

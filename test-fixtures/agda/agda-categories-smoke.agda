{-# OPTIONS --without-K --safe #-}

open import Categories.Category.Core using (Category)
open import Level using (suc; _⊔_)

module source where

idCategoryGoal : ∀ {o ℓ e} → Category o ℓ e → Category o ℓ e
idCategoryGoal C = {!   !}

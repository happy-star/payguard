import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import { CheckoutPage } from "@/pages/CheckoutPage";
import { ComposePage } from "@/pages/ComposePage";
import { DealPage } from "@/pages/DealPage";
import { DealsPage } from "@/pages/DealsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<ComposePage />} />
          <Route path="/deals" element={<DealsPage />} />
          <Route path="/deals/:id" element={<DealPage />} />
          <Route path="/checkout/:id" element={<CheckoutPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

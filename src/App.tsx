import { useState } from "react";
import FactoryPage from "./FactoryPage";
import PlannerPage from "./PlannerPage";
import "./style.css";

type PageType = "manual" | "planner";

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>("manual");

  return (
    <div className="w-full h-screen bg-gray-100 flex flex-col">
      <header className="bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg">
        <div className="p-5 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Factory Simulator</h1>
          <p className="text-sm mt-2 opacity-90">
            AI-Powered Factory Simulation & Optimization
          </p>
        </div>
        <nav className="flex gap-1 px-4 pb-0 bg-blue-800">
          <button
            onClick={() => setCurrentPage("manual")}
            className={`relative px-8 py-4 font-semibold text-base transition-all duration-200 rounded-t-lg ${
              currentPage === "manual"
                ? "bg-gray-100 text-blue-800 shadow-lg"
                : "bg-blue-700 text-blue-100 hover:bg-blue-600 hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Manual Control
            </span>
            {currentPage === "manual" && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600"></div>
            )}
          </button>
          <button
            onClick={() => setCurrentPage("planner")}
            className={`relative px-8 py-4 font-semibold text-base transition-all duration-200 rounded-t-lg ${
              currentPage === "planner"
                ? "bg-gray-100 text-indigo-800 shadow-lg"
                : "bg-blue-700 text-blue-100 hover:bg-blue-600 hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Automatic Optimization
            </span>
            {currentPage === "planner" && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600"></div>
            )}
          </button>
        </nav>
      </header>
      {currentPage === "manual" ? <FactoryPage /> : <PlannerPage />}
    </div>
  );
}

export default App;

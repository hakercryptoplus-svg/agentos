import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import sessionsRouter from "./sessions.js";
import memoryRouter from "./memory.js";
import skillsRouter from "./skills.js";
import toolsRouter from "./tools.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(memoryRouter);
router.use(skillsRouter);
router.use(toolsRouter);

export default router;

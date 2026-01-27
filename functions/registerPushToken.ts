import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { token, action = 'add' } = await req.json();

    if (!token) {
      return Response.json({ error: 'Token is required' }, { status: 400 });
    }

    // Get current user data
    const userData = await base44.entities.User.get(user.id);
    const currentTokens = userData.push_tokens || [];

    let updatedTokens;
    if (action === 'add') {
      // Add token if not already exists
      updatedTokens = currentTokens.includes(token) 
        ? currentTokens 
        : [...currentTokens, token];
    } else if (action === 'remove') {
      // Remove token
      updatedTokens = currentTokens.filter(t => t !== token);
    } else {
      return Response.json({ error: 'Invalid action. Use "add" or "remove"' }, { status: 400 });
    }

    // Update user with new tokens
    await base44.entities.User.update(user.id, {
      push_tokens: updatedTokens
    });

    return Response.json({
      success: true,
      message: `Token ${action}ed successfully`,
      tokenCount: updatedTokens.length
    });

  } catch (error) {
    console.error('Register push token error:', error);
    return Response.json({ 
      error: 'Failed to register push token',
      details: error.message 
    }, { status: 500 });
  }
});
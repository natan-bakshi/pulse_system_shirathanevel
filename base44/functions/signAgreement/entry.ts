import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    console.log('=== signAgreement function started ===');
    try {
        const base44 = createClientFromRequest(req);
        console.log('1. base44 client created');
        
        const user = await base44.auth.me();
        console.log('2. User authenticated:', user ? `ID: ${user.id}, Email: ${user.email}` : 'No user');
        if (!user) {
            console.log('ERROR: User not authenticated');
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        console.log('3. Request body parsed, fields:', { 
            hasHtml: !!body.agreementHtmlContent,
            hasUserAgent: !!body.userAgent,
            hasHash: !!body.contentHash
        });
        const { agreementHtmlContent, userAgent, contentHash } = body;

        if (!agreementHtmlContent || !userAgent || !contentHash) {
            console.log('ERROR: Missing required fields');
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Get IP address from request headers
        const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                          req.headers.get('x-real-ip') || 
                          'unknown';
        console.log('4. IP address extracted:', ipAddress);

        // Create HTML file with full agreement content
        const htmlBlob = new Blob([agreementHtmlContent], { type: 'text/html; charset=utf-8' });
        const htmlFile = new File([htmlBlob], `agreement_${user.id}_${Date.now()}.html`, { type: 'text/html' });
        console.log('5. HTML file created, size:', htmlBlob.size, 'bytes');

        // Upload the agreement file to private storage
        console.log('6. Uploading file to private storage...');
        const uploadResponse = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ 
            file: htmlFile 
        });
        console.log('7. Upload response:', uploadResponse ? `file_uri: ${uploadResponse.file_uri}` : 'null');

        if (!uploadResponse?.file_uri) {
            console.log('ERROR: Failed to upload agreement file');
            throw new Error('Failed to upload agreement file');
        }

        // Create the SignedAgreement record
        console.log('8. Creating SignedAgreement record...');
        const signedAgreement = await base44.asServiceRole.entities.SignedAgreement.create({
            user_id: user.id,
            user_email: user.email,
            user_full_name: user.full_name || '',
            signed_date: new Date().toISOString(),
            agreement_content_uri: uploadResponse.file_uri,
            ip_address: ipAddress,
            user_agent: userAgent,
            content_hash: contentHash,
            agreement_version: '1.0'
        });
        console.log('9. SignedAgreement created successfully, ID:', signedAgreement.id);

        console.log('=== signAgreement completed successfully ===');
        return Response.json({ 
            success: true,
            agreement_id: signedAgreement.id,
            signed_date: signedAgreement.signed_date
        });

    } catch (error) {
        console.error('=== ERROR in signAgreement ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        return Response.json({ error: error.message }, { status: 500 });
    }
});